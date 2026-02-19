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
  // Handle both plural_order_id and order_id from callback
  const pluralOrderId = body.plural_order_id || body.order_id;
  const path = body.payment_id || pluralOrderId;
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

  const orderdetails = await getOrderDocument(pluralOrderId, 'update', masterdata);
  console.log(
    'Order Details for the pluralOrderId : ' + pluralOrderId,
    JSON.stringify(orderdetails.data),
  );

  if (orderdetails.data.length === 0) {
    const pluralOrderData = await getPluralOrderStatus(pluralOrderId, keys);
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
        pluralOrderId,
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
        pluralOrderId +
        ' . Updating Vtex status to FAILED',
      body: JSON.stringify({
        request: body,
        orderdetails: orderdetails,
        updateResponse: vtexStatusUpdateResponse.data,
      }),
    });
    ctx.status = 200;
    ctx.body = {
      message: 'No order details in masterdata with plural order id : ' + pluralOrderId,
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
  if (body.payment_id && body.error_code !== '4010') {
    paymentDetails = await getPluralPaymentById(pluralOrderId, body.payment_id, keys);
  } else {
    paymentDetails = await getPluralPaymentByOrderId(pluralOrderId, keys);
  }
  addLog(ctx, {
    orderId: orderdetails.data[0]?.vtexOrderId,
    email: orderdetails.data[0]?.email ?? null,
    message:
      'updatePaymentStatus: Getting Plural payment details. pluralOrderId - ' +
      pluralOrderId +
      ' , pluralPaymentId - ' +
      body.payment_id,
    body: JSON.stringify({ result: paymentDetails }),
  });

  // Handle Plural API error - keep payment pending for webhook
  if (paymentDetails.isError) {
    console.log('🔴 PLURAL API ERROR HANDLED - Keeping payment pending for webhook');
    console.log({ pluralOrderId, error: paymentDetails.data });
    
    addLog(ctx, {
      orderId: orderdetails.data[0]?.vtexOrderId,
      email: orderdetails.data[0]?.email ?? null,
      message: '🔴 PLURAL API ERROR - Payment kept pending for webhook processing',
      body: JSON.stringify({ error: paymentDetails.data, pluralOrderId }),
    });

    ctx.status = 200;
    ctx.body = {
      status: 'undefined',
      paymentId: orderdetails.data[0].vtexPaymentId,
      message: paymentDetails.data?.error_message || 'Plural API error',
    };
    return;
  } else {
    console.log('✅ PLURAL API SUCCESS - Payment details retrieved');
    console.log({ 
      pluralOrderId: pluralOrderId,
      orderStatus: paymentDetails.data?.status,
      paymentDetails: paymentDetails.data?.payments?.[0],
      fullData: paymentDetails.data 
    });
  }

  if (
    body.payment_id &&
    paymentDetails.data.status !== constants.PLURAL.STATUS.ORDER_ATTEMPTED
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
        value: paymentDetails.data.payments?.[0]?.status ?? paymentDetails.data.status ?? '',
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
  if (!orderdetails.data[0].status) {
    vtexStatusUpdateResponse = await updateVtexPaymentStatus(
      paymentDetails.data.status,
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





export async function paymentWebhook(ctx: any) {
  console.log('============*PAYMENT WEBHOOKS WITH SIGNATURE VERIFICATION*============');
  const {
    vtex: { authToken },
    clients: { masterdata, apps  },
  } = ctx;

  let rawBody = '';
  let body: any;

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.req) {
      chunks.push(chunk);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');

    if (!rawBody) {
      ctx.status = 400;
      ctx.body = { error: 'Empty request body' };
      return;
    }

    const appSettings = await getAppSettings(apps);
    const secretKey = appSettings.secretCode;  

    if (!secretKey) {
      ctx.status = 500;
      ctx.body = { error: 'Webhook secret key not configured' };
      return;
    }

    const signatureVerification = await verifyWebhookSignature(rawBody, ctx.headers, secretKey);

    if (!signatureVerification.valid) {
      ctx.status = 401;
      ctx.body = { error: 'Invalid webhook signature' };
      return;
    }

    body = JSON.parse(rawBody);
    
    if (body.event_type === 'ORDER_PROCESSED' && body.data) {
      body = {
        merchant_data: {
          order_id: body.data.order_id,
          plural_order_id: body.data.order_id
        },
        order_data: {
          plural_order_id: body.data.order_id,
          order_status: body.data.status
        },
        payment_info_data: {
          payment_status: body.data.status,
          payment_id: body.data.order_id
        }
      };
    }

  } catch (error) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid request body format' };
    return;
  }

  if (!body.merchant_data?.order_id || !body.order_data?.order_status) {
    ctx.status = 400;
    ctx.body = { error: 'Missing required fields' };
    return;
  }

  const orderId = body.merchant_data.order_id;
  const pluralOrderId = body.merchant_data.plural_order_id || orderId;
  const paymentStatus = body.order_data.order_status;

  const orderdetails = await getOrderDocument(pluralOrderId, 'update', masterdata);

  if (orderdetails.isError || orderdetails.data.length === 0) {
    ctx.status = 404;
    ctx.body = { error: 'Order not found', pluralOrderId };
    return;
  }

  const order = orderdetails.data[0];

  if ((paymentStatus === 'PROCESSED' || paymentStatus === 'CHARGED') && 
      !order.status && 
      order.vtexPaymentId && 
      order.callbackUrl) {
    
    try {
      await updateVtexPaymentStatus(paymentStatus, order.vtexPaymentId, order.callbackUrl, authToken);
      
      // Single success log
      console.log(`✅ WEBHOOK SUCCESS: VTEX Order ${order.vtexOrderId} | Plural Order ${pluralOrderId} | Status: ${paymentStatus}`);

    


      
      ctx.status = 200;
      ctx.body = { 
        success: true,
        vtexOrderId: order.vtexOrderId,
        pluralOrderId: pluralOrderId,
        status: paymentStatus
      };
      return;
    } catch (vtexError) {
      ctx.status = 500;
      ctx.body = { 
        error: 'VTEX update failed',
        vtexOrderId: order.vtexOrderId,
        pluralOrderId: pluralOrderId
      };
      return;
    }
  }

 
  
  ctx.status = 200;
  ctx.body = { 
    success: true,
    vtexOrderId: order.vtexOrderId,
    pluralOrderId: pluralOrderId,
    status: paymentStatus
  };
}

import { createHmac, timingSafeEqual } from 'crypto';

interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
}

async function verifyWebhookSignature(
  rawBody: string,
  headers: any,
  secretKey: string
): Promise<SignatureVerificationResult> {
  try {
    const webhookId = headers['webhook-id'];
    const webhookTimestamp = headers['webhook-timestamp'];
    const webhookSignature = headers['webhook-signature'];

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return { valid: false, error: 'Missing required headers' };
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(webhookTimestamp, 10);
    const maxAge = 300;

    if (Math.abs(currentTimestamp - timestamp) > maxAge) {
      return { valid: false, error: 'Timestamp expired' };
    }

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expectedSignature = createHmac('sha256', secretKey)
      .update(signedContent, 'utf8')
      .digest('base64');

    const actualSignature = webhookSignature.startsWith('v1,') 
      ? webhookSignature.substring(3) 
      : webhookSignature;

    const expectedBuffer = Buffer.from(expectedSignature, 'base64');
    const actualBuffer = Buffer.from(actualSignature, 'base64');

    if (expectedBuffer.length !== actualBuffer.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const signatureValid = timingSafeEqual(expectedBuffer, actualBuffer);

    if (!signatureValid) {
      return { valid: false, error: 'Signature mismatch' };
    }

    return { valid: true };

  } catch (error) {
    return { valid: false, error: 'Signature verification failed' };
  }
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
