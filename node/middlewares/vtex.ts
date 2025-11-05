import { MasterData } from '@vtex/api';
import {
  AuthorizationRequest,
  AuthorizationResponse,
  RefundRequest,
  Refunds,
} from '@vtex/payment-provider';
import axios from 'axios';
import { json } from 'co-body';
import { addLog } from '../masterdata/logs';
import { getOrderDocument, partialOrderDocumentUpdate } from '../masterdata/orderSchema';
//import { PinelabsWebhookBody } from '../typings/pinelabs';
import { Keys } from '../typings/vtex';
import { randomString } from '../utils';
import { getAppSettings } from '../utils/app-settings';
import { constants } from '../utils/constant';
import { getPluralPaymentById, getPluralPaymentByOrderId, getPluralPayments } from './pinelabs';
import { getOrderVBase, save, saveOrderVBase } from './vbase';





export async function updatePaymentStatus(ctx: any) {
  console.log('============*UPDATING PAYMENT STATUS*============');
  const {
    vtex: { authToken },
    clients: { masterdata, apps, vbase },
  } = ctx;
  const body = await json(ctx.req);
  let vtexStatusUpdateResponse = null;
  const { error_code, error_message } = body;
  const path = body.payment_id ? body.payment_id : body.plural_order_id;
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
  const vtexPaymentId: string = body.callbackUrl.split('/')[7];
  console.log({ body });
  console.log({ path });

  if (error_message) {
    const data = { code: error_code, message: error_message };
    const result = await save(vbase, path, data);

    console.log({ result });
  }

  const orderdetails = await getOrderDocument(body.plural_order_id, 'update', masterdata);
  console.log(
    'Order Details for the pluralOrderId : ' + body.plural_order_id,
    JSON.stringify(orderdetails.data),
  );

  if (orderdetails.data.length === 0) {
    const pluralOrderData = await getPluralOrderStatus(body.plural_order_id, keys);
    console.log({ pluralOrderData: pluralOrderData.data });
    if (pluralOrderData.data && !pluralOrderData.isError) {
      const vbaseOrder: any = await getOrderVBase(
        vbase,
        pluralOrderData.data.merchant_data.order_id,
      );
      console.log({ orderId: pluralOrderData.data.merchant_data.order_id });
      console.log({ vbaseOrder });
      if (vbaseOrder && !vbaseOrder.isError) {
        orderdetails.data.push(vbaseOrder);
      }
      addLog(ctx, {
        orderId: pluralOrderData.data.merchant_data.order_id,
        email: null,
        message:
          'updatePaymentStatus: gerOrderDocument returned empty array! Trying to fetch data from VBase',
        body: JSON.stringify(vbaseOrder),
      });
    }
  }

  if (orderdetails.isError) {
    addLog(ctx, {
      orderId: orderdetails.data[0]?.vtexOrderId,
      email: orderdetails.data[0]?.email ?? null,
      message:
        'updatePaymentStatus: Error while getting document with pluralOrderId : ' +
        body.plural_order_id,
      body: JSON.stringify({ request: body, orderdetails: orderdetails }),
    });
    ctx.status = 500;
    ctx.body = orderdetails;
    return;
  }

  if (!orderdetails.data.length) {
    vtexStatusUpdateResponse = await updateVtexPaymentStatus(
      'FAILED',
      vtexPaymentId,
      body.callbackUrl,
      authToken,
    );
    addLog(ctx, {
      orderId: orderdetails.data[0]?.vtexOrderId,
      email: orderdetails.data[0]?.email ?? null,
      message:
        'updatePaymentStatus: No order details in masterdata with : ' +
        body.plural_order_id +
        ' . Updating Vtex status to FAILED',
      body: JSON.stringify({
        request: body,
        orderdetails: orderdetails,
        updateResponse: vtexStatusUpdateResponse.data,
      }),
    });
    ctx.status = 200;
    ctx.body = {
      message: 'No order details in masterdata with plural order id : ' + body.plural_order_id,
      data: orderdetails.data,
    };
    return;
  }

  addLog(ctx, {
    orderId: orderdetails.data[0]?.vtexOrderId,
    email: orderdetails.data[0]?.email ?? null,
    message: 'updatePaymentStatus function called',
    body: JSON.stringify({ request: body, orderdetails: orderdetails }),
  });

  let paymentDetails: any = {};
  if (body.error_code === '4010') {
    paymentDetails = await getPluralPaymentByOrderId(body.plural_order_id, keys);
  } else {
    paymentDetails = await getPluralPaymentById(body.plural_order_id, body.payment_id, keys);
  }
  addLog(ctx, {
    orderId: orderdetails.data[0]?.vtexOrderId,
    email: orderdetails.data[0]?.email ?? null,
    message:
      'updatePaymentStatus: Getting Plural payment details. pluralOrderId - ' +
      body.plural_order_id +
      ' , pluralPaymentId - ' +
      body.payment_id,
    body: JSON.stringify({ result: paymentDetails }),
  });

  if (
    body.payment_id &&
    paymentDetails.data.order_data.order_status !== constants.PLURAL.STATUS.ORDER_ATTEMPTED
  ) {
    if (
      !orderdetails.data ||
      orderdetails.data.length === 0 ||
      !orderdetails.data[0]?.pluralPaymentId ||
      (orderdetails.data[0]?.pluralPaymentId &&
        parseInt(orderdetails.data[0]?.pluralPaymentId) < body.payment_id)
    ) {
      const newValues: any = [];
      newValues.push({ field: 'status', value: true });
      newValues.push({
        field: 'pinelabsPaymentStatus',
        value: paymentDetails.data.payment_info_data?.payment_status ?? '',
      });
      if (body.payment_id) {
        newValues.push({
          field: 'pluralPaymentId',
          value: body.payment_id.toString(),
        });
      }

      console.log({ newValues });

      const updatedDocument = await partialOrderDocumentUpdate(
        orderdetails.data[0].id,
        newValues,
        masterdata,
      );

      let vbaseOrder: any = await getOrderVBase(vbase, orderdetails.data[0].vtexOrderId);

      if (vbaseOrder && !vbaseOrder.isError) {
        for (let newVal of newValues) {
          vbaseOrder[newVal.field] = newVal.value;
        }
        await saveOrderVBase(vbase, vbaseOrder.vtexOrderId, vbaseOrder);
      }

      if (updatedDocument.isError) {
        console.log(
          'Error while updating document with documentId : ' + orderdetails.data[0].id,
          updatedDocument.data,
        );
        ctx.status = 500;
        ctx.body = updatedDocument;
        return;
      }
    }
  }
  if (!paymentDetails.isError && !orderdetails.data[0].status) {
    vtexStatusUpdateResponse = await updateVtexPaymentStatus(
      paymentDetails.data.order_data.order_status,
      orderdetails.data[0].vtexPaymentId,
      body.callbackUrl,
      authToken,
    );

    addLog(ctx, {
      orderId: orderdetails.data[0]?.vtexOrderId,
      email: orderdetails.data[0]?.email ?? null,
      message: `updatePaymentStatus: Update Vtex payment status`,
      body: JSON.stringify(vtexStatusUpdateResponse.data),
    });
  }

  ctx.status = 200;
  ctx.body = vtexStatusUpdateResponse;
  return;
}

async function updateVtexPaymentStatus(
  orderStatus: any,
  paymentId: any,
  // authorization: any,
  // ctx: any,
  callbackUrl: any,
  authToken: any,
) {
  console.log({ orderStatus });
  console.log({ paymentId });
  // const pinelabs = new PineLabs(ctx);
  let authorizationResponse = <AuthorizationResponse>{};
  let request = null;
  let authorizationRequest = <AuthorizationRequest>{ paymentId: paymentId };
  if (orderStatus === 'CHARGED' || orderStatus === 'PROCESSED') {
    authorizationResponse = <AuthorizationResponse>{
      paymentId: authorizationRequest.paymentId,
      status: 'approved',
      authorizationId: randomString(),
      nsu: randomString(),
      delayToAutoSettle: 10,
      delayToAutoSettleAfterAntifraud: 120,
      delayToCancel: 1000,
    };
    console.log('Order is charged - ');
  } else if (orderStatus === 'PENDING' || orderStatus === 'ORDER_ATTEMPTED') {
    // await pinelabs.retry(authorization);
    return { isError: false, data: { status: orderStatus } };
  } else if (orderStatus === 'FAILED' || orderStatus === 'REJECTED') {
    request = {
      paymentId: authorizationRequest.paymentId,
      status: 'denied',
      message: 'test',
    };
  } else if (orderStatus === 'ORDER_CREATED') {
    request = {
      paymentId: authorizationRequest.paymentId,
      status: 'denied',
    };
  }

  const inboundAPI = axios.create({
    baseURL: callbackUrl.replace('https', 'http'),
    timeout: 180000,
    headers: {
      'X-VTEX-Use-Https': 'true',
      'Proxy-Authorization': authToken,
    },
  });
  try {
    const response: any = await inboundAPI.post('/', request ? request : authorizationResponse);
    console.log('Updating the payment status ------>  ', response.data);
    return { isError: false, data: response.data };
  } catch (error) {
    console.log(error);
    return { isError: true, data: { error: error.response.data, request } };
  }
}

function updateRefundByWebhook(
  pinelabsPaymentStatus: string,
  vtexPaymentId: any,
  refundId: string,
) {
  let requestResponse: any = { paymentId: vtexPaymentId };
  if (pinelabsPaymentStatus === 'REFUNDED') {
    Refunds.approve(requestResponse, {
      refundId,
    });
  } else {
    Refunds.deny(requestResponse, {
      message: 'Error while refunding payment with status: ' + pinelabsPaymentStatus,
      code: '400',
    });
  }
}



export async function paymentWebhook(ctx: any) {
  console.log('============*PAYMENT WEBHOOKS*============');
  const {
    vtex: { authToken },
    clients: { masterdata, vbase },
  } = ctx;

  let vtexStatusUpdateResponse = null;
  
  // Parse incoming request body
  let body: any;
  try {
    // First try to get raw body
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');

    if (!rawBody) {
      throw new Error('Empty request body');
    }

    // Parse as URL-encoded form data
    const formData = new URLSearchParams(rawBody);
    body = {
      merchant_data: {
        order_id: formData.get('order_id')
      },
      order_data: {
        plural_order_id: formData.get('order_id'),
        order_status: formData.get('status')
      },
      payment_info_data: {
        payment_status: formData.get('status'),
        payment_id: formData.get('order_id')
      }
    };

    // Handle wakeup call (if needed)
    if (formData.get('wakeup')) {
      ctx.status = 200;
      ctx.body = 'already awaken';
      return;
    }
  } catch (error) {
    addLog(ctx, {
      orderId: 'unknown',
      email: null,
      message: 'Webhook: Failed to parse request body',
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    ctx.status = 400;
    ctx.body = { error: 'Invalid request body format' };
    return;
  }

  // Validate required data
  if (!body.merchant_data?.order_id || !body.order_data?.order_status) {
    addLog(ctx, {
      orderId: 'unknown',
      email: null,
      message: 'Webhook: Missing required fields in webhook data',
      body: JSON.stringify(body),
    });
    ctx.status = 400;
    ctx.body = { error: 'Missing required fields in webhook data' };
    return;
  }

  const orderId = body.merchant_data.order_id;
  const pluralOrderId = body.merchant_data.plural_order_id || orderId;
  const paymentStatus = body.order_data.order_status;
  const paymentInfo = body.payment_info_data || { 
    payment_status: body.order_data.order_status,
    payment_id: body.order_data.plural_order_id || orderId
  };

  addLog(ctx, {
    orderId: orderId,
    email: null,
    message: 'Payment webhook received',
    body: JSON.stringify(body),
  });

  // Rest of your existing logic remains the same...
  // Get order details from MasterData
  const orderdetails = await getOrderDocument(
    pluralOrderId,
    'update',
    masterdata,
  );

  // Fallback to VBase if MasterData returns empty
  if (orderdetails.data.length === 0) {
    const vbaseOrder: any = await getOrderVBase(vbase, orderId);
    console.log({ vbaseOrder });
    
    if (vbaseOrder && !vbaseOrder.isError) {
      orderdetails.data.push(vbaseOrder);
    }

    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'Webhook: Order not found in MasterData, checking VBase',
      body: JSON.stringify(vbaseOrder),
    });
  }

  // ... continue with the rest of your existing logic
  // Handle errors from order details fetch
  if (orderdetails.isError) {
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'Webhook: Error fetching order details',
      body: JSON.stringify({
        error: orderdetails.error,
        searchQuery: orderdetails.searchQuery,
      }),
    });
    ctx.status = 500;
    ctx.body = orderdetails;
    return;
  }

  // Check if order was found
  if (orderdetails.data.length === 0) {
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'Webhook: Order not found in MasterData or VBase',
      body: JSON.stringify({
        pluralOrderId: pluralOrderId,
      }),
    });
    ctx.status = 404;
    ctx.body = { error: 'Order not found' };
    return;
  }

  const order = orderdetails.data[0];

  // Log order creation time for buffer check
  console.log('Order created date:', order.createdIn);
  const orderCreationDate = new Date(order.createdIn);
  const currentDate = new Date();
  orderCreationDate.setHours(orderCreationDate.getHours() + 1); // Add 1 hour buffer

  // Skip failed status if within buffer time
  if (paymentStatus === 'FAILED' && currentDate < orderCreationDate) {
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'WEBHOOK: Payment failed but within buffer time, skipping update',
      body: null,
    });
    ctx.status = 200;
    ctx.body = {};
    return;
  }

  // Check if status needs to be updated
  if (
    (!order.status || order.pinelabsPaymentStatus !== paymentInfo.payment_status) &&
    paymentInfo.payment_status !== 'ORDER_ATTEMPTED'
  ) {
    const newValues: { field: string; value: any }[] = [
      { field: 'status', value: true },
      { field: 'pinelabsPaymentStatus', value: paymentInfo.payment_status },
    ];

    if (paymentInfo.payment_id) {
      newValues.push({
        field: 'pluralPaymentId',
        value: paymentInfo.payment_id.toString(),
      });
    }

    // Update MasterData
    const updatedDocument = await partialOrderDocumentUpdate(order.id, newValues, masterdata);

    // Update VBase if needed
    let vbaseOrder: any = await getOrderVBase(vbase, orderId);
    if (vbaseOrder && !vbaseOrder.isError) {
      for (const newVal of newValues) {
        vbaseOrder[newVal.field] = newVal.value;
      }
      await saveOrderVBase(vbase, vbaseOrder.vtexOrderId, vbaseOrder);
    }

    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'Webhook: Updated payment status in MasterData and VBase',
      body: JSON.stringify({
        updates: newValues,
        result: updatedDocument,
      }),
    });

    if (updatedDocument.isError) {
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: 'Webhook: Failed to update order document',
        body: JSON.stringify({
          error: updatedDocument.isError,
          documentId: order.id,
        }),
      });
      ctx.status = 500;
      ctx.body = updatedDocument;
      return;
    }

    // Handle refund if present
    if (paymentInfo.refund_id) {
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: `Webhook: Processing refund - ${paymentStatus}`,
        body: JSON.stringify({
          refundId: paymentInfo.refund_id,
          paymentId: order.vtexPaymentId,
        }),
      });
      
      updateRefundByWebhook(
        paymentStatus,
        order.vtexPaymentId,
        paymentInfo.refund_id,
      );
      ctx.status = 200;
      ctx.body = {};
      return;
    }

    // Update VTEX payment status
    try {
      vtexStatusUpdateResponse = await updateVtexPaymentStatus(
        paymentStatus,
        order.vtexPaymentId,
        order.callbackUrl,
        authToken,
      );

      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: `Webhook: Updated VTEX payment status to ${paymentStatus}`,
        body: JSON.stringify({
          response: vtexStatusUpdateResponse,
        }),
      });
    } catch (vtexError) {
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: 'Webhook: Failed to update VTEX payment status',
        body: JSON.stringify({
          error: vtexError.message,
          paymentStatus: paymentStatus,
          vtexPaymentId: order.vtexPaymentId,
        }),
      });
      ctx.status = 500;
      ctx.body = { error: 'Failed to update VTEX payment status' };
      return;
    }
  }


  if (vtexStatusUpdateResponse && !vtexStatusUpdateResponse.isError) {
    if (paymentStatus === 'PROCESSED') {
      // Construct the success URL (modify this based on your store's URL structure)
      const successUrl = `https://${ctx.vtex.host}/checkout/orderPlaced/?og=${order.vtexOrderId}`;
      
      ctx.status = 200;
      ctx.body = {
        redirectUrl: successUrl, // Redirect to order confirmation page
      };
      return;
    }
  }

  

  ctx.status = 200;
  ctx.body = {};
}

export async function updateRefundStatus(
  orderstatus: string,
  refund: RefundRequest,
  refundDetails: any,
) {
  let refundResponse;
  if (orderstatus === 'REFUNDED' || orderstatus === 'PARTIAL_REFUNDED') {
    // console.log('--------------------VTEX REFUND STATUS APPROVED--------------------');
    refundResponse = Refunds.approve(refund, {
      refundId: refundDetails.payment_info_data.refund_id,
      code: refundDetails.payment_info_data.payment_response_code,
      message: 'Refund Successfull, Details --> ' + JSON.stringify(refundDetails.data),
    });
  } else {
    // console.log('---------------------VTEX REFUND STATUS DENIED----------------------');
    refundResponse = Refunds.deny(refund, {
      message: 'Refund Failed, Details --> ' + JSON.stringify(refundDetails.data),
      code: refundDetails.payment_info_data.payment_response_code,
    });
  }
  return refundResponse;
}

export async function getSKUReferenceCode(
  skuId: any,
  account: any,
  authToken: any,
  isEmployee: boolean,
) {
  const options: any = {
    method: 'GET',
    url: `http://${account}.vtexcommercestable.com.br/api/catalog/pvt/stockkeepingunit/${skuId}`,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-VTEX-Use-Https': 'true',
      VtexIdClientAutCookie: authToken,
    },
  };

  const sku: any = await axios
    .request(options)
    .then(function (response) {
      return { isError: false, payload: response.data };
    })
    .catch(function (error) {
      return { isError: true, payload: error.response };
    });

  const skuReferenceId = !sku.isError
    ? sku.payload.RefId ?? Math.floor(Math.random() * 90000) + 10000
    : Math.floor(Math.random() * 90000) + 10000;

  return skuReferenceId ? (isEmployee ? skuReferenceId + 'e' : skuReferenceId) : skuReferenceId;
}

export const checkIsEmployee = async (
  authorization: AuthorizationRequest,
  masterdata: MasterData,
) => {
  let isEmployee = false;
  let result: any = [];
  result = await masterdata.searchDocuments({
    dataEntity: constants.masterdata.USER_DATA_ENTITY,
    fields: constants.masterdata.FIELDS,
    where: 'email=' + authorization.miniCart.buyer.email,
    pagination: {
      page: 1,
      pageSize: 10,
    },
  });
  // console.log('DOCUMENTS FROM MASTER DATA : ', result);

  if (
    result &&
    result.length > 0 &&
    result[0].customerClass === constants.whirlpool.EMPLOYEE_CUS_CLASS
  ) {
    isEmployee = true;
  }

  return isEmployee;
};

export async function getPluralOrderStatus(pluralOrderId: any, keys: any) {
  const pluralDetails: any = await getPluralPayments(pluralOrderId, keys);
  const paymentinfo = pluralDetails.data;
  
  if (pluralDetails.isError) {
    return { isError: true, status: paymentinfo.error_message, data: paymentinfo };
  }

  // Use the direct status field from the response instead of order_data.order_status
  return { 
    isError: false, 
    status: paymentinfo.status, // Changed from paymentinfo.order_data.order_status
    data: paymentinfo 
  };
}
