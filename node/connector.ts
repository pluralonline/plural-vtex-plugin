import {
  AuthorizationRequest,
  AuthorizationResponse,
  Authorizations,
  CancellationRequest,
  CancellationResponse,
  Cancellations,
  PaymentProvider,
  RefundRequest,
  RefundResponse,
  Refunds,
  SettlementRequest,
  SettlementResponse,
  Settlements,
} from '@vtex/payment-provider';
import { buildHeader, buildRequestPayload } from './builders/orderBuilder';
import { Clients } from './clients';
import { addLog, createLogsSchema } from './masterdata/logs';
import {
  createCheckoutOrderSchema,
  createOrderDocument,
  getOrderDocument,
} from './masterdata/orderSchema';
import { createOrderPinelabs, refundProcedure } from './middlewares/pinelabs';
import { getOrderVBase, saveOrderVBase } from './middlewares/vbase';
import { checkIsEmployee, getPluralOrderStatus } from './middlewares/vtex';
import { Keys } from './typings/vtex';
import { randomString } from './utils';
import { getAppSettings } from './utils/app-settings';
import { constants } from './utils/constant';
import { getPluralErrorMessage } from './utils/errorMessages';
import { hash } from './utils/hash';
import { configureUnhealthyScheduler } from './utils/utils';

const { v4: uuidv4 } = require('uuid');
export default class PineLabs extends PaymentProvider<Clients> {
  public async authorize(authorization: AuthorizationRequest): Promise<AuthorizationResponse> {
    const body: any = this.context.req;
    const {
      clients: { masterdata, vbase },
      vtex: { account, authToken },
    } = this.context;
    let vtexUpdateStatus = null;

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'Authorization function called',
      body: JSON.stringify(authorization),
    });
    console.log('AUTHORIZE function called');

    const appSettings = await getAppSettings(this.context.clients.apps);
    const keys: Keys = {
      publicKey: appSettings.app_key,
      secretKey: appSettings.app_token,
      merchantId: appSettings.merchantId,
      accessCode: appSettings.accessCode,
      secretCode: appSettings.secretCode,
      baseUrl: appSettings.baseUrl,
      pluralScriptUrl: appSettings.pluralScriptUrl,
    };

    //Create schema for LOGS
    await createLogsSchema(this.context);

    //Create a scheduler for unhealthy check
    configureUnhealthyScheduler(authorization, this.context);

    const schema = await createCheckoutOrderSchema(this.context);
    if (schema?.isError) {
      return Authorizations.deny(authorization, {
        message:
          'Authorization Declined - Issue while creating schema, Please contact your administrator.',
      });
    }

    const paymentDetails = await getOrderDocument(
      authorization.orderId,
      'authorization',
      masterdata,
    );

    if (paymentDetails.data.length === 0) {
      const vbaseOrder: any = await getOrderVBase(vbase, authorization.orderId);
      console.log({ vbaseOrder });
      if (vbaseOrder && !vbaseOrder.isError) {
        paymentDetails.data.push(vbaseOrder);
        addLog(this.context, {
          orderId: authorization.orderId,
          email: null,
          message:
            'authorize: gerOrderDocument returned empty array! Trying to fetch data from VBase',
          body: JSON.stringify(vbaseOrder),
        });
      }
    }

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'authorize: Vtex Order Document with order id - ' + authorization.orderId,
      body: JSON.stringify(paymentDetails),
    });
    console.log('Payment details: ', JSON.stringify(paymentDetails.data));

    if (!paymentDetails.isError && paymentDetails.data.length) {
      const pluralOrderId = paymentDetails.data[0].pluralOrderId;
      const pluralPaymentId = paymentDetails.data[0].pluralPaymentId;
      const pluralOrderStatus = await getPluralOrderStatus(pluralOrderId, keys);
      console.log({ pluralOrderStatus });

      if (pluralOrderStatus.isError) {
        //plural payment id when user cancel the order or bank has cancelled the payment
        addLog(this.context, {
          orderId: authorization.orderId,
          email: authorization.miniCart.buyer.email ?? null,
          message: `authorize: Plural Error Message for OrderID ${pluralOrderId} is ${JSON.stringify(
            pluralOrderStatus.data?.error_message,
          )}`,
          body: JSON.stringify(pluralOrderStatus),
        });
        return Authorizations.deny(authorization, {
          message: getPluralErrorMessage(pluralOrderStatus.data?.error_message),
          code: '500',
        });
      }

      vtexUpdateStatus = await this.updateOrderStatus(
        pluralOrderStatus.status,
        authorization.paymentId,
        pluralOrderStatus.data,
        authorization,
        pluralOrderStatus.data,
      );

      addLog(this.context, {
        orderId: authorization.orderId,
        email: authorization.miniCart.buyer.email ?? null,
        message:
          'authorize: Plural Payment Details: pluralOrderId - ' +
          pluralOrderId +
          ' , pluralPaymentId - ' +
          pluralPaymentId,
        body: JSON.stringify({
          pluralInquiryData: pluralOrderStatus.data,
          vtexStatus: vtexUpdateStatus,
        }),
      });

      return vtexUpdateStatus;
    }

    const isEmployee = await checkIsEmployee(authorization, masterdata);

    console.log('IS EMPLOOYEE : ', isEmployee);

    const payload = await buildRequestPayload(
      authorization,
      keys,
      body.headers['x-forwarded-host'],
      account,
      authToken,
      isEmployee,
    );

    console.log('ORDER PAYLOAD', payload);

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const hash256OfEncodedPayload = await hash(encodedPayload, keys.secretCode);

    const headers = await buildHeader(hash256OfEncodedPayload, keys);

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'authorize: Request to Create Order Pinelabs',
      body: JSON.stringify({
        payload: payload,
        encodedPayload: encodedPayload,
        headers: headers,
      }),
    });

    const pinelabsOrder = await createOrderPinelabs(keys.baseUrl, encodedPayload, headers);

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'authorize: Response of Create Order in Pinelabs',
      body: JSON.stringify({ response: pinelabsOrder }),
    });

    if (pinelabsOrder.isError) {
      return Authorizations.deny(authorization, {
        message: getPluralErrorMessage(pinelabsOrder.data.error_message),
        code: pinelabsOrder.data.error_code,
      });
    }

    pinelabsOrder.data.callbackUrl = authorization.callbackUrl;
    pinelabsOrder.data.pluralScriptUrl = keys.pluralScriptUrl;

    const newVtexOrder = {
      vtexOrderId: authorization.orderId,
      vtexPaymentId: authorization.paymentId,
      pluralOrderId: pinelabsOrder.data.plural_order_id,
      pluralPaymentId: '',
      callbackUrl: authorization.callbackUrl,
      status: false,
      items: {
        total: authorization.value,
        items: authorization.miniCart.items,
      },
    };

    const orderDocument = await createOrderDocument(newVtexOrder, keys, masterdata);
    const date = new Date();
    await saveOrderVBase(vbase, newVtexOrder.vtexOrderId, {
      ...newVtexOrder,
      createdIn: date.toISOString(),
    });

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'authorize: Vtex Order Document Creation while creating pinelabs order : ',
      body: JSON.stringify(orderDocument),
    });

    if (orderDocument.isError) {
      return Authorizations.deny(authorization, {
        message: 'Issue while creating the Document',
        code: '400',
      });
    }

    return Authorizations.pending(authorization, {
      delayToCancel: 864000,
      authorizationId: randomString(),
      paymentAppData: {
        appName: 'vtexasia.connector-pinelabs',
        payload: JSON.stringify(pinelabsOrder),
      },
    });
  }

  public async cancel(cancellation: CancellationRequest): Promise<CancellationResponse> {
    console.log('CANCEL function called');
    const {
      vtex: { logger },
      clients: { apps, masterdata },
    } = this.context;

    logger.info({
      message: 'Cancel function called',
      data: JSON.stringify(cancellation),
    });

    const appSettings = await getAppSettings(apps);
    const keys: Keys = {
      publicKey: appSettings.app_key,
      secretKey: appSettings.app_token,
      merchantId: appSettings.merchantId,
      accessCode: appSettings.accessCode,
      secretCode: appSettings.secretCode,
      baseUrl: appSettings.baseUrl,
      pluralScriptUrl: appSettings.pluralScriptUrl,
    };

    //CHECKING IF STATUS IS STILL ORDER_ATTEMPTED AND IF YES CANCEL THE ORDER(AS THE TIMEOUT).
    const orderDetails = await getOrderDocument(
      cancellation.paymentId,
      'refund-cancel',
      masterdata,
    );
    console.log({ orderDetails });
    console.log('ORDER DETAILS DATA IN CANCELLATION API', orderDetails.data);

    if (orderDetails.isError || (!orderDetails.isError && orderDetails.data[0].length === 0)) {
      return Cancellations.deny(cancellation, {
        message: orderDetails.isError
          ? JSON.stringify(orderDetails.data)
          : 'Order details not found for PaymentId : ' + cancellation.paymentId,
        code: '400',
      });
    }

    const pluralOrderId = orderDetails.data[0].pluralOrderId;
    const pluralOrderStatus = await getPluralOrderStatus(pluralOrderId, keys);
    console.log('PLURAL ORDER STATUS : ', JSON.stringify(pluralOrderStatus));

    if (
      pluralOrderStatus.status === constants.PLURAL.STATUS.ORDER_ATTEMPTED ||
      pluralOrderStatus.status === constants.PLURAL.STATUS.FAILED
    )
      return Cancellations.approve(cancellation, {
        cancellationId: randomString(),
      });

    const refundResponse: any = await refundProcedure(
      this.context,
      keys,
      'refund-cancel',
      cancellation.paymentId,
      null,
      masterdata,
    );

    if (refundResponse.isError) {
      return Cancellations.deny(cancellation, {
        message: refundResponse.data,
        code: refundResponse.data.message,
      });
    }

    if (
      refundResponse.message === 'DUPLICATE_UNIQUE_ID_FOUND' ||
      refundResponse.message === 'NO_ORDER_DETAILS_FOUND'
    ) {
      return Cancellations.deny(cancellation, {
        message: refundResponse.data,
        code: refundResponse.data.message,
      });
    }

    return Cancellations.approve(cancellation, {
      cancellationId: randomString(),
    });
  }

  public async refund(refund: RefundRequest): Promise<RefundResponse> {
    console.log('REFUND function called');
    const {
      vtex: { logger },
      clients: { apps, masterdata },
    } = this.context;

    logger.info({
      message: 'Refund function called',
      data: JSON.stringify(refund),
    });

    const appSettings = await getAppSettings(apps);
    const keys: Keys = {
      publicKey: appSettings.app_key,
      secretKey: appSettings.app_token,
      merchantId: appSettings.merchantId,
      accessCode: appSettings.accessCode,
      secretCode: appSettings.secretCode,
      baseUrl: appSettings.baseUrl,
      pluralScriptUrl: appSettings.pluralScriptUrl,
    };

    let refundResponse: any = await refundProcedure(
      this.context,
      keys,
      'refund-items',
      refund.paymentId,
      refund.value,
      masterdata,
    );

    if (refundResponse.isError) {
      return Refunds.deny(refund, {
        message: refundResponse.data,
        code: refundResponse.data.message,
      });
    }

    if (
      refundResponse.message === 'DUPLICATE_UNIQUE_ID_FOUND' ||
      refundResponse.message === 'NO_ORDER_DETAILS_FOUND'
    ) {
      return Refunds.deny(refund, {
        message: refundResponse.data,
        code: refundResponse.data.message,
      });
    }

    return refundResponse;
  }

  public async settle(settlement: SettlementRequest): Promise<SettlementResponse> {
    console.log('SETTLE function called');
    return Settlements.approve(settlement, {
      settleId: uuidv4(),
      code: '200',
      message: 'succesfully settled!',
    });
  }

  async updateOrderStatus(
    orderStatus: string,
    paymentId: string,
    orderDetails: any,
    authorization: AuthorizationRequest,
    errorReason: any,
  ) {
    console.log({ orderStatus });
    console.log({ paymentId });
    const payment: any = { paymentId: paymentId };

    const paymentDetails = orderDetails.payment_info_data.map((res: any) => {
      return {
        payment_id: res.payment_id,
        payment_status: res.payment_status,
      };
    });

    addLog(this.context, {
      orderId: authorization.orderId,
      email: authorization.miniCart.buyer.email ?? null,
      message: 'authorize: Update Vtex Order Status with status: ' + orderStatus,
      body: JSON.stringify({ orderDetails, errorReason }),
    });

    if (orderStatus === 'CHARGED' || orderStatus === 'CAPTURED') {
      console.log('Order is charged');
      return Authorizations.approve(payment, {
        authorizationId: randomString(),
        nsu: randomString(),
        tid: randomString(),
      });
    } else if (orderStatus === 'PENDING' || orderStatus === 'ORDER_ATTEMPTED') {
      // await this.retry(authorization);
      return Authorizations.pending(authorization, {
        delayToCancel: 864000,
        authorizationId: randomString(),
      });
    } else if (
      orderStatus === 'FAILURE' ||
      orderStatus === 'FAILED' ||
      orderStatus === 'REJECTED'
    ) {
      return Authorizations.deny(payment, {
        message:
          'Plural Order Status : ' +
          orderDetails?.order_data?.order_status +
          ' with payment details : ' +
          JSON.stringify(paymentDetails),
        code: '500',
      });
    } else {
      return Authorizations.deny(payment, {
        message: errorReason?.message
          ? errorReason?.message + 'with status code : ' + errorReason?.code
          : 'Transaction Failed with status : ' + orderStatus,
        code: '500',
      });
    }
  }

  public inbound: undefined;
}
