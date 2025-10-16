import { MasterData } from '@vtex/api';
import {
  AuthorizationRequest,
  RefundRequest,
  Refunds,
} from '@vtex/payment-provider';
import axios from 'axios';
import { json } from 'co-body';
import { addLog } from '../masterdata/logs';
import { getOrderDocument, partialOrderDocumentUpdate } from '../masterdata/orderSchema';
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
  console.log('📧 UpdatePaymentStatus - Raw body:', JSON.stringify(body, null, 2));

  let vtexStatusUpdateResponse = null;
  
  // Extract data from BOTH legacy and V3 formats
  const pluralOrderId = body.plural_order_id || body.order_id; // V3 uses order_id
  const paymentStatus = body.status; // V3 uses status directly
  const error_code = body.error_code;
  const error_message = body.error_message;
  const callbackUrl = body.callbackUrl;
  
  console.log('🔍 Extracted values:', {
    pluralOrderId,
    paymentStatus,
    error_code,
    error_message,
    callbackUrl
  });

  if (!pluralOrderId) {
    console.error('❌ No pluralOrderId or order_id found in request');
    ctx.status = 400;
    ctx.body = { error: 'Missing order identification' };
    return;
  }

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

  // Extract vtexPaymentId safely
  let vtexPaymentId = '';
  try {
    vtexPaymentId = callbackUrl?.split('/')[7] || '';
    console.log('🎯 Extracted vtexPaymentId:', vtexPaymentId);
  } catch (error) {
    console.error('❌ Error extracting vtexPaymentId:', error);
  }

  // Handle errors first
  if (error_message) {
    console.log('⚠️ Processing error case:', { error_code, error_message });
    const data = { code: error_code, message: error_message };
    const result = await save(vbase, pluralOrderId, data);
    console.log('💾 Error saved to VBase:', { result });
  }

  // Get order details
  const orderdetails = await getOrderDocument(pluralOrderId, 'update', masterdata);
  console.log(
    '📊 Order Details for pluralOrderId: ' + pluralOrderId,
    JSON.stringify(orderdetails.data),
  );

  // Fallback to VBase if MasterData is empty
  if (orderdetails.data.length === 0) {
    console.log('🔄 No data in MasterData, checking VBase...');
    const pluralOrderData = await getPluralOrderStatus(pluralOrderId, keys);
    console.log({ pluralOrderData: pluralOrderData.data });
    
    if (pluralOrderData.data && !pluralOrderData.isError) {
      const orderId = pluralOrderData.data.merchant_data?.order_id || pluralOrderId;
      const vbaseOrder: any = await getOrderVBase(vbase, orderId);
      console.log({ orderId, vbaseOrder });
      
      if (vbaseOrder && !vbaseOrder.isError) {
        orderdetails.data.push(vbaseOrder);
        console.log('✅ Added VBase order to orderdetails');
      }
      
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: 'updatePaymentStatus: Fallback to VBase data',
        body: JSON.stringify(vbaseOrder),
      });
    }
  }

  if (orderdetails.isError) {
    addLog(ctx, {
      orderId: orderdetails.data[0]?.vtexOrderId,
      email: orderdetails.data[0]?.email ?? null,
      message: 'updatePaymentStatus: Error while getting document with pluralOrderId: ' + pluralOrderId,
      body: JSON.stringify({ request: body, orderdetails: orderdetails }),
    });
    ctx.status = 500;
    ctx.body = orderdetails;
    return;
  }

  if (!orderdetails.data.length) {
    console.log('❌ No order details found, marking as failed');
    if (vtexPaymentId) {
      vtexStatusUpdateResponse = await updateVtexPaymentStatus(
        'FAILED',
        vtexPaymentId,
        callbackUrl,
        authToken,
        'API' 
      );
    }
    
    addLog(ctx, {
      orderId: 'unknown',
      email: null,
      message: 'updatePaymentStatus: No order details in masterdata with: ' + pluralOrderId,
      body: JSON.stringify({
        request: body,
        orderdetails: orderdetails,
        updateResponse: vtexStatusUpdateResponse?.data,
      }),
    });
    
    ctx.status = 200;
    ctx.body = {
      message: 'No order details in masterdata with plural order id: ' + pluralOrderId,
      data: orderdetails.data,
    };
    return;
  }

  const order = orderdetails.data[0];
  console.log('✅ Found order:', {
    vtexOrderId: order.vtexOrderId,
    vtexPaymentId: order.vtexPaymentId,
    currentStatus: order.status
  });

  addLog(ctx, {
    orderId: order.vtexOrderId,
    email: order.email ?? null,
    message: 'updatePaymentStatus function called',
    body: JSON.stringify({ request: body, orderdetails: orderdetails }),
  });

  // Get payment details from Plural - only if we have payment_id
  let paymentDetails: any = {};
  const payment_id = body.payment_id;
  
  if (payment_id) {
    if (error_code === '4010') {
      paymentDetails = await getPluralPaymentByOrderId(pluralOrderId, keys);
    } else {
      paymentDetails = await getPluralPaymentById(pluralOrderId, payment_id, keys);
    }
    
    console.log('📄 Payment Details from Plural:', JSON.stringify(paymentDetails, null, 2));
    
    addLog(ctx, {
      orderId: order.vtexOrderId,
      email: order.email ?? null,
      message: 'updatePaymentStatus: Getting Plural payment details',
      body: JSON.stringify({ result: paymentDetails }),
    });
  }

  // Determine the final status to use
  let finalStatus = paymentStatus; // Start with webhook status
  
  

  console.log('🎯 Final status to process:', finalStatus);

  // Update order document if needed
  if (payment_id && !paymentDetails.isError && paymentDetails.data) {
    const apiStatus = paymentDetails.data.order_data?.order_status || 
                     paymentDetails.data.status;
    
    if (apiStatus && apiStatus !== constants.PLURAL.STATUS.ORDER_ATTEMPTED) {
      const shouldUpdate = !order.status || 
                          !order.pluralPaymentId || 
                          (order.pluralPaymentId && parseInt(order.pluralPaymentId) < parseInt(payment_id));

      if (shouldUpdate) {
        console.log('📝 Updating order document with new payment data');
        const newValues: any = [
          { field: 'status', value: true },
          { field: 'pinelabsPaymentStatus', value: apiStatus },
        ];

        if (payment_id) {
          newValues.push({
            field: 'pluralPaymentId',
            value: payment_id.toString(),
          });
        }

        console.log('💾 New values to update:', newValues);

        const updatedDocument = await partialOrderDocumentUpdate(
          order.id,
          newValues,
          masterdata,
        );

        // Update VBase as well
        let vbaseOrder: any = await getOrderVBase(vbase, order.vtexOrderId);
        if (vbaseOrder && !vbaseOrder.isError) {
          for (let newVal of newValues) {
            vbaseOrder[newVal.field] = newVal.value;
          }
          await saveOrderVBase(vbase, vbaseOrder.vtexOrderId, vbaseOrder);
        }

        if (updatedDocument.isError) {
          console.error('❌ Error updating document:', updatedDocument.data);
        } else {
          console.log('✅ Order document updated successfully');
        }
      }
    }
  }

  
  console.log('🔍 Status check before VTEX update:', {
  hasFinalStatus: !!finalStatus,
  finalStatus,
  hasVtexPaymentId: !!order.vtexPaymentId,
  hasCallbackUrl: !!callbackUrl,
  orderAlreadyProcessed: !!order.status,
  canUpdate: finalStatus && order.vtexPaymentId && callbackUrl && !order.status
});

  if (finalStatus && order.vtexPaymentId && callbackUrl && !order.status) {
    console.log('🔄 Updating VTEX status to:', finalStatus);
    
    vtexStatusUpdateResponse = await updateVtexPaymentStatus(
      finalStatus,
      order.vtexPaymentId,
      callbackUrl,
      authToken,
       'API' // ← Explicitly pass 'API'
    );

    // Always update order document when we process a webhook
    console.log('📝 Updating order document with status:', finalStatus);
    const newValues: any = [
      { field: 'status', value: true },
      { field: 'pinelabsPaymentStatus', value: finalStatus },
    ];

    // Only add pluralPaymentId if we have it
    if (payment_id) {
      newValues.push({
        field: 'pluralPaymentId',
        value: payment_id.toString(),
      });
    }

    try {
      const updatedDocument = await partialOrderDocumentUpdate(
        order.id,
        newValues,
        masterdata,
      );

      // Update VBase as well
      let vbaseOrder: any = await getOrderVBase(vbase, order.vtexOrderId);
      if (vbaseOrder && !vbaseOrder.isError) {
        for (let newVal of newValues) {
          vbaseOrder[newVal.field] = newVal.value;
        }
        await saveOrderVBase(vbase, vbaseOrder.vtexOrderId, vbaseOrder);
        console.log('✅ VBase updated successfully');
      }

      if (updatedDocument.isError) {
        console.error('❌ Error updating MasterData document:', updatedDocument.data);
        addLog(ctx, {
          orderId: order.vtexOrderId,
          email: order.email ?? null,
          message: 'updatePaymentStatus: Failed to update MasterData',
          body: JSON.stringify(updatedDocument.data),
        });
      } else {
        console.log('✅ MasterData updated successfully');
        addLog(ctx, {
          orderId: order.vtexOrderId,
          email: order.email ?? null,
          message: `updatePaymentStatus: Order document updated to ${finalStatus}`,
          body: JSON.stringify(newValues),
        });
      }
    } catch (updateError) {
      console.error('❌ Order document update failed:', updateError);
      addLog(ctx, {
        orderId: order.vtexOrderId,
        email: order.email ?? null,
        message: 'updatePaymentStatus: Error updating order document',
        body: JSON.stringify({ error: updateError.message }),
      });
    }

   if (vtexStatusUpdateResponse && !vtexStatusUpdateResponse.isError) {
  addLog(ctx, {
    orderId: order.vtexOrderId,
    email: order.email ?? null,
    message: `updatePaymentStatus: VTEX payment status updated to ${finalStatus} successfully`,
    body: JSON.stringify({
      vtexResponse: vtexStatusUpdateResponse.data,
      status: finalStatus
    }),
  });
} else {
  addLog(ctx, {
    orderId: order.vtexOrderId,
    email: order.email ?? null,
    message: `updatePaymentStatus: VTEX status update failed - ${finalStatus}`,
    body: JSON.stringify(vtexStatusUpdateResponse),
  });
}
  } else {
    console.log('⏸️  Cannot update - missing required data:', {
      hasFinalStatus: !!finalStatus,
      hasVtexPaymentId: !!order.vtexPaymentId,
      hasCallbackUrl: !!callbackUrl,
      orderAlreadyProcessed: !!order.status
    });
  }

  ctx.status = 200;
  ctx.body = vtexStatusUpdateResponse || { message: 'Processing completed' };
  return;
}

async function updateVtexPaymentStatus(
  orderStatus: any,
  paymentId: any,
  callbackUrl: any,
  authToken: any,
  source: string = 'API'
) {
  console.log('🔄 updateVtexPaymentStatus called:', { orderStatus, paymentId, source });
  
  let request = null;
  
  const normalizedStatus = orderStatus?.toUpperCase();
  console.log('🔍 Normalized status:', normalizedStatus);

  // Create unique identifiers that include source
  const authId = source === 'WEBHOOK' 
    ? `WH_${randomString()}`  // WH = Webhook
    : `API_${randomString()}`; // API = Direct API
    
  const nsuId = source === 'WEBHOOK'
    ? `WH_${randomString()}`
    : `API_${randomString()}`;

  if (normalizedStatus === 'CHARGED' || normalizedStatus === 'PROCESSED') {
    request = {
      paymentId: paymentId,
      status: 'approved',
      // Include source in the IDs that VTEX displays
      authorizationId: authId,
      nsu: nsuId,
      tid: randomString(),
      authorizationCode: randomString().substring(0, 6),
      // Use acquirer field to indicate source
      acquirer: source === 'WEBHOOK' ? 'Pinelabs-Webhook' : 'Pinelabs-Direct',
      // Try message with source prefix
      message: source === 'WEBHOOK' ? 'WEBHOOK: Payment approved' : 'API: Payment approved',
      code: '200',
      delayToAutoSettle: 10,
      delayToAutoSettleAfterAntifraud: 120,
      delayToCancel: 1000,
    };
    console.log(`✅ Order is charged/processed - Source: ${source}`);
  } else if (normalizedStatus === 'PENDING' || normalizedStatus === 'ORDER_ATTEMPTED') {
    console.log(`⏸️  Order is pending, no VTEX update needed - Source: ${source}`);
    return { 
      isError: false, 
      data: { 
        status: orderStatus,
        source: source 
      } 
    };
  } else if (normalizedStatus === 'FAILED' || normalizedStatus === 'REJECTED') {
    request = {
      paymentId: paymentId,
      status: 'denied',
      authorizationId: source === 'WEBHOOK' ? `WH_${randomString()}` : `API_${randomString()}`,
      nsu: source === 'WEBHOOK' ? `WH_${randomString()}` : `API_${randomString()}`,
      acquirer: source === 'WEBHOOK' ? 'Pinelabs-Webhook' : 'Pinelabs-Direct',
      message: source === 'WEBHOOK' ? 'WEBHOOK: Payment failed' : 'API: Payment failed',
      code: '400',
    };
    console.log(`❌ Order is denied/failed - Source: ${source}`);
  } else {
    console.warn(`⚠️  Unknown status, defaulting to denied - Source: ${source}`, orderStatus);
    request = {
      paymentId: paymentId,
      status: 'denied',
      authorizationId: source === 'WEBHOOK' ? `WH_${randomString()}` : `API_${randomString()}`,
      nsu: source === 'WEBHOOK' ? `WH_${randomString()}` : `API_${randomString()}`,
      acquirer: source === 'WEBHOOK' ? 'Pinelabs-Webhook' : 'Pinelabs-Direct',
      message: source === 'WEBHOOK' ? `WEBHOOK: Unknown status` : `API: Unknown status`,
      code: '400',
    };
  }

  console.log(`📦 Request payload created: ${!!request} - Source: ${source}`);
  if (request) {
    console.log('📝 Request details:', JSON.stringify(request, null, 2));
  }

  if (!request) {
    console.log(`🚫 No request needed, returning early - Source: ${source}`);
    return { isError: false, data: { status: 'no-update-needed', source: source } };
  }

  const inboundAPI = axios.create({
    baseURL: callbackUrl,
    timeout: 30000,
    headers: {
      'X-VTEX-Use-Https': 'true',
      'Proxy-Authorization': authToken,
      'Content-Type': 'application/json',
    },
  });
  
  try {
    console.log(`📤 Making VTEX API call to: ${callbackUrl} - Source: ${source}`);
    console.log(`⏱️  Starting API call at: ${new Date().toISOString()} - Source: ${source}`);
    
    const response: any = await inboundAPI.post('/', request);
    
    console.log(`✅ VTEX API call successful at: ${new Date().toISOString()} - Source: ${source}`);
    console.log('📄 Response data:', response.data);
    console.log('🔧 Response status:', response.status);
    
    // Create a custom log entry that might appear in VTEX
    console.log(`🎯 PAYMENT_${source}_PROCESSED: ${paymentId} | Status: ${orderStatus} | Time: ${new Date().toISOString()}`);
    
    if (response.status === 204) {
      console.log(`✅ VTEX 204 No Content - Payment status updated successfully - Source: ${source}`);
      return { 
        isError: false, 
        data: { 
          message: `Payment status updated successfully via ${source}`,
          status: 'approved',
          vtexStatus: 204,
          source: source,
          paymentId: paymentId
        } 
      };
    }
    
    return { 
      isError: false, 
      data: {
        ...response.data,
        source: source,
        paymentId: paymentId
      } 
    };
  } catch (error) {
    console.error(`❌ VTEX API call failed - Source: ${source}:`);
    
    const err = error as any;
    console.error('💬 Error message:', err.message);
    console.error('🔍 Error code:', err.code);
    console.error('⏰ Timed out:', err.code === 'ECONNABORTED');
    
    if (err.response) {
      console.error('📡 Response status:', err.response.status);
      console.error('📡 Response data:', err.response.data);
    } else if (err.request) {
      console.error('🔌 No response received');
    }
    
    return { 
      isError: true, 
      data: { 
        error: err.response?.data || err.message,
        request,
        source: source,
        paymentId: paymentId
      } 
    };
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


interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
}


export async function paymentWebhook(ctx: any) {
  console.log('============*PAYMENT WEBHOOKS WITH SIGNATURE VERIFICATION*============');
  const {
    vtex: { authToken },
    clients: { masterdata, vbase, apps },
  } = ctx;

  let vtexStatusUpdateResponse = null;
  
  // Get raw body first for signature verification
  let rawBody = '';
  let body: any;
  
  try {
    // Capture raw body for signature verification
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.req) {
      chunks.push(chunk);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');

    if (!rawBody) {
      throw new Error('Empty request body');
    }

    console.log('📧 Raw webhook body length:', rawBody.length);

    // Get app settings for secret key
    const appSettings = await getAppSettings(apps);
    const secretKey = appSettings.secretCode;  

    if (!secretKey) {
      console.error('❌ No webhook secret key configured');
      addLog(ctx, {
        orderId: 'unknown',
        email: null,
        message: 'WEBHOOK: No webhook secret key configured',
        body: null,
      });
      ctx.status = 500;
      ctx.body = { error: 'Webhook secret key not configured' };
      return;
    }

    // Verify webhook signature
    const signatureVerification = await verifyWebhookSignature(
      rawBody,
      ctx.headers,
      secretKey
    );

    if (!signatureVerification.valid) {
      console.error('❌ Webhook signature verification failed:', signatureVerification.error);
      
      addLog(ctx, {
        orderId: 'unknown',
        email: null,
        message: 'WEBHOOK: Signature verification failed',
        body: JSON.stringify({
          error: signatureVerification.error,
          headers: {
            'webhook-id': ctx.headers['webhook-id']?.substring(0, 10) + '...',
            'webhook-timestamp': ctx.headers['webhook-timestamp'],
            'webhook-signature': ctx.headers['webhook-signature']?.substring(0, 20) + '...'
          }
        }),
      });
      
      ctx.status = 401;
      ctx.body = { 
        error: 'Invalid webhook signature',
        message: signatureVerification.error
      };
      return;
    }

    console.log('✅ Webhook signature verified successfully');

    // Now parse the body
    try {
      body = JSON.parse(rawBody);
      console.log('✅ Parsed as JSON webhook');
      
      // Transform Shopify format to your expected format
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
    } catch (jsonError) {
      // If JSON parsing fails, try URL-encoded form data (old format)
      console.log('🔄 Falling back to form data parsing');
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
    }

    console.log('🔍 Parsed webhook data:', JSON.stringify(body, null, 2));

  } catch (error) {
    addLog(ctx, {
      orderId: 'unknown',
      email: null,
      message: 'Webhook: Failed to process request body',
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        rawBody: rawBody.substring(0, 500) + '...'
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

  console.log('🎯 Webhook Processing:', {
    orderId,
    pluralOrderId, 
    paymentStatus,
    paymentInfo
  });

  addLog(ctx, {
    orderId: orderId,
    email: null,
    message: `WEBHOOK: Signature verified & payment webhook received with status: ${paymentStatus}`,
    body: JSON.stringify({
      signature: 'verified',
      orderId,
      paymentStatus,
      rawBody: rawBody.substring(0, 1000) + '...' // Log first 1000 chars
    }),
  });

  // Get order details from MasterData
  const orderdetails = await getOrderDocument(
    pluralOrderId,
    'update',
    masterdata,
  );

  console.log('📊 Order details from MasterData:', {
    found: orderdetails.data.length > 0,
    count: orderdetails.data.length,
    isError: orderdetails.isError
  });

  // Fallback to VBase if MasterData returns empty
  if (orderdetails.data.length === 0) {
    console.log('🔄 No data in MasterData, checking VBase...');
    const vbaseOrder: any = await getOrderVBase(vbase, orderId);
    console.log('💾 VBase order:', vbaseOrder);
    
    if (vbaseOrder && !vbaseOrder.isError) {
      orderdetails.data.push(vbaseOrder);
      console.log('✅ Added VBase order to orderdetails');
    }

    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'WEBHOOK: Order not found in MasterData, checking VBase',
      body: JSON.stringify(vbaseOrder),
    });
  }

  // Handle errors from order details fetch
  if (orderdetails.isError) {
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'WEBHOOK: Error fetching order details',
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
    console.log('❌ No order found for pluralOrderId:', pluralOrderId);
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'WEBHOOK: Order not found in MasterData or VBase',
      body: JSON.stringify({
        pluralOrderId: pluralOrderId,
      }),
    });
    ctx.status = 404;
    ctx.body = { error: 'Order not found' };
    return;
  }

  const order = orderdetails.data[0];
  console.log('✅ Found order:', {
    vtexOrderId: order.vtexOrderId,
    vtexPaymentId: order.vtexPaymentId,
    currentStatus: order.status,
    currentPinelabsStatus: order.pinelabsPaymentStatus,
    callbackUrl: order.callbackUrl
  });

  // Log order creation time for buffer check
  console.log('📅 Order created date:', order.createdIn);
  const orderCreationDate = new Date(order.createdIn);
  const currentDate = new Date();
  orderCreationDate.setHours(orderCreationDate.getHours() + 1); // Add 1 hour buffer

  console.log('⏰ Date comparison:', {
    orderCreation: orderCreationDate.toISOString(),
    currentTime: currentDate.toISOString(),
    isWithinBuffer: currentDate < orderCreationDate
  });

  // Skip failed status if within buffer time
  if (paymentStatus === 'FAILED' && currentDate < orderCreationDate) {
    console.log('⏸️  Payment failed but within buffer time, skipping update');
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: 'WEBHOOK: Payment failed but within buffer time, skipping update',
      body: null,
    });
    ctx.status = 200;
    ctx.body = { message: 'Payment failed but within buffer time, update skipped' };
    return;
  }

  // CRITICAL: Check if we should update VTEX status
  const shouldUpdateVtex = (
    // Only update if payment is PROCESSED/CHARGED
    (paymentStatus === 'PROCESSED' || paymentStatus === 'CHARGED') &&
    // Only update if order is not already processed in our system
    !order.status &&
    // Only update if we have required data
    order.vtexPaymentId && 
    order.callbackUrl
  );

  console.log('🔍 Status Update Decision:', {
    paymentStatus,
    isProcessedOrCharged: (paymentStatus === 'PROCESSED' || paymentStatus === 'CHARGED'),
    orderAlreadyProcessed: order.status,
    hasVtexPaymentId: !!order.vtexPaymentId,
    hasCallbackUrl: !!order.callbackUrl,
    shouldUpdateVtex: shouldUpdateVtex
  });

  // Check if status needs to be updated in MasterData
  const shouldUpdateMasterData = (
    !order.status || 
    order.pinelabsPaymentStatus !== paymentInfo.payment_status
  ) && paymentInfo.payment_status !== 'ORDER_ATTEMPTED';

  console.log('🔍 MasterData Update Decision:', {
    shouldUpdateMasterData,
    currentStatus: order.status,
    currentPinelabsStatus: order.pinelabsPaymentStatus,
    newPinelabsStatus: paymentInfo.payment_status,
    isOrderAttempted: paymentInfo.payment_status === 'ORDER_ATTEMPTED'
  });

  if (shouldUpdateMasterData) {
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

    console.log('📝 Updating MasterData with:', newValues);

    // Update MasterData
    const updatedDocument = await partialOrderDocumentUpdate(order.id, newValues, masterdata);

    // Update VBase if needed
    let vbaseOrder: any = await getOrderVBase(vbase, orderId);
    if (vbaseOrder && !vbaseOrder.isError) {
      for (const newVal of newValues) {
        vbaseOrder[newVal.field] = newVal.value;
      }
      await saveOrderVBase(vbase, vbaseOrder.vtexOrderId, vbaseOrder);
      console.log('✅ VBase updated successfully');
    }

    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: `WEBHOOK: Updated payment status in MasterData and VBase to ${paymentInfo.payment_status}`,
      body: JSON.stringify({
        updates: newValues,
        result: updatedDocument,
      }),
    });

    if (updatedDocument.isError) {
      console.error('❌ Failed to update MasterData:', updatedDocument.data);
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: 'WEBHOOK: Failed to update order document',
        body: JSON.stringify({
          error: updatedDocument.isError,
          documentId: order.id,
        }),
      });
      ctx.status = 500;
      ctx.body = updatedDocument;
      return;
    } else {
      console.log('✅ MasterData updated successfully');
    }
  } else {
    console.log('⏸️  No MasterData update needed');
  }

  // Handle refund if present
  if (paymentInfo.refund_id) {
    console.log('🔄 Processing refund:', paymentInfo.refund_id);
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: `WEBHOOK: Processing refund - ${paymentStatus}`,
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
    ctx.body = { message: 'Refund processed' };
    return;
  }

  // Update VTEX payment status ONLY if conditions are met
  if (shouldUpdateVtex) {
    console.log('🔄 Updating VTEX payment status to:', paymentStatus);
    
    try {
      vtexStatusUpdateResponse = await updateVtexPaymentStatus(
        paymentStatus,
        order.vtexPaymentId,
        order.callbackUrl,
        authToken,
        'WEBHOOK'
      );

      console.log('📊 VTEX Update Response:', {
        isError: vtexStatusUpdateResponse?.isError,
        data: vtexStatusUpdateResponse?.data
      });

      if (vtexStatusUpdateResponse && !vtexStatusUpdateResponse.isError) {
        console.log('✅ VTEX payment status updated successfully via WEBHOOK');
        addLog(ctx, {
          orderId: orderId,
          email: null,
          message: `WEBHOOK: VTEX payment status updated to ${paymentStatus} SUCCESSFULLY`,
          body: JSON.stringify({
            response: vtexStatusUpdateResponse,
            source: 'WEBHOOK',
            vtexOrderId: order.vtexOrderId,
            pluralOrderId: pluralOrderId,
            signature: 'verified'
          }),
        });
      } else {
        console.error('❌ VTEX payment status update failed via WEBHOOK');
        addLog(ctx, {
          orderId: orderId,
          email: null,
          message: `WEBHOOK: VTEX payment status update FAILED for ${paymentStatus}`,
          body: JSON.stringify({
            response: vtexStatusUpdateResponse,
            error: vtexStatusUpdateResponse?.data,
            signature: 'verified'
          }),
        });
      }
    } catch (vtexError) {
      console.error('❌ Exception during VTEX status update:', vtexError);
      addLog(ctx, {
        orderId: orderId,
        email: null,
        message: 'WEBHOOK: Failed to update VTEX payment status - Exception',
        body: JSON.stringify({
          error: vtexError.message,
          paymentStatus: paymentStatus,
          vtexPaymentId: order.vtexPaymentId,
          signature: 'verified'
        }),
      });
    }
  } else {
    console.log('⏸️  VTEX status update skipped:', {
      reason: !shouldUpdateVtex ? 'Conditions not met' : 'Already processed',
      paymentStatus,
      orderAlreadyProcessed: order.status,
      hasRequiredData: !!(order.vtexPaymentId && order.callbackUrl)
    });
    
    addLog(ctx, {
      orderId: orderId,
      email: null,
      message: `WEBHOOK: VTEX status update SKIPPED for ${paymentStatus}`,
      body: JSON.stringify({
        reason: 'Conditions not met or already processed',
        paymentStatus,
        orderAlreadyProcessed: order.status,
        hasVtexPaymentId: !!order.vtexPaymentId,
        hasCallbackUrl: !!order.callbackUrl,
        signature: 'verified'
      }),
    });
  }

  // Return success response (no redirect for webhooks)
  console.log('✅ Webhook processing completed successfully with signature verification');
  ctx.status = 200;
  ctx.body = { 
    message: 'Webhook processed successfully with signature verification',
    orderId: order.vtexOrderId,
    status: paymentStatus,
    source: 'WEBHOOK',
    signature: 'verified'
  };
  return;
}

// Add the signature verification function
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
    console.log('🔐 Starting webhook signature verification');
    
    const webhookId = headers['webhook-id'];
    const webhookTimestamp = headers['webhook-timestamp'];
    const webhookSignature = headers['webhook-signature'];

    console.log('📋 Webhook headers:', {
      webhookId,
      webhookTimestamp,
      webhookSignature: webhookSignature?.substring(0, 50) + '...',
      bodyLength: rawBody.length,
      secretKeyAvailable: !!secretKey
    });

    // Check if required headers are present
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error('❌ Missing required webhook headers');
      return {
        valid: false,
        error: 'Missing required webhook headers (webhook-id, webhook-timestamp, webhook-signature)'
      };
    }

    // Validate timestamp (prevent replay attacks)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(webhookTimestamp, 10);
    const maxAge = 300; // 5 minutes in seconds

    console.log('⏰ Timestamp validation:', {
      currentTimestamp,
      webhookTimestamp: timestamp,
      age: currentTimestamp - timestamp,
      maxAge,
      isValidTime: Math.abs(currentTimestamp - timestamp) <= maxAge
    });

    if (Math.abs(currentTimestamp - timestamp) > maxAge) {
      console.error('❌ Webhook timestamp is outside acceptable range');
      return {
        valid: false,
        error: `Webhook timestamp is outside acceptable range. Current: ${currentTimestamp}, Webhook: ${timestamp}, Difference: ${currentTimestamp - timestamp}`
      };
    }

    // Generate the signature to compare
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    
    console.log('📝 Signed content details:', {
      webhookIdLength: webhookId.length,
      timestampLength: webhookTimestamp.length,
      bodyLength: rawBody.length,
      signedContentLength: signedContent.length,
      signedContentPreview: signedContent.substring(0, 100) + '...'
    });

    // IMPORTANT: The secret key from Plural dashboard should be used as-is
    // No base64 encoding of the secret key before using it
    const secretKeyString = secretKey;
    
    console.log('🔑 Secret key details:', {
      secretKeyLength: secretKeyString.length,
      secretKeyPreview: secretKeyString.substring(0, 10) + '...', // Only log first 10 chars for security
      isBase64: /^[A-Za-z0-9+/]*={0,2}$/.test(secretKeyString) && secretKeyString.length % 4 === 0
    });

    try {
      // Generate HMAC SHA-256 signature
      const expectedSignature = createHmac('sha256', secretKeyString)
        .update(signedContent, 'utf8')
        .digest('base64');

      // Extract the actual signature from the header (remove 'v1,' prefix if present)
      const actualSignature = webhookSignature.startsWith('v1,') 
        ? webhookSignature.substring(3) 
        : webhookSignature;

      console.log('🔍 Signature comparison:', {
        signedContentLength: signedContent.length,
        expectedSignature: expectedSignature,
        actualSignature: actualSignature,
        expectedSignatureLength: expectedSignature.length,
        actualSignatureLength: actualSignature.length
      });

      // Debug: Log the raw values for manual verification
      console.log('🐛 DEBUG - Raw values for manual verification:', {
        webhookId,
        webhookTimestamp,
        rawBodyPreview: rawBody.substring(0, 200) + '...',
        secretKeyPreview: secretKeyString.substring(0, 10) + '...',
        signedContentPreview: signedContent.substring(0, 200) + '...'
      });

      // Use timing-safe comparison to prevent timing attacks
      const expectedBuffer = Buffer.from(expectedSignature, 'base64');
      const actualBuffer = Buffer.from(actualSignature, 'base64');

      if (expectedBuffer.length !== actualBuffer.length) {
        console.error('❌ Signature length mismatch');
        console.error('Expected length:', expectedBuffer.length);
        console.error('Actual length:', actualBuffer.length);
        return {
          valid: false,
          error: `Signature length mismatch. Expected: ${expectedBuffer.length}, Actual: ${actualBuffer.length}`
        };
      }

      const signatureValid = timingSafeEqual(expectedBuffer, actualBuffer);

      if (!signatureValid) {
        console.error('❌ Signature mismatch - values do not match');
        
        // Additional debug: Try with base64 decoded secret (if the secret is base64 encoded)
        try {
          const secretBytes = Buffer.from(secretKeyString, 'base64');
          const alternativeSignature = createHmac('sha256', secretBytes)
            .update(signedContent, 'utf8')
            .digest('base64');
          
          console.log('🔄 Alternative signature (with base64 decoded secret):', alternativeSignature);
          console.log('🔍 Alternative comparison:', {
            alternativeMatches: alternativeSignature === actualSignature
          });
        } catch (altError) {
          console.log('🔄 Alternative method failed:', altError);
        }
        
        return {
          valid: false,
          error: 'Signature mismatch'
        };
      }

      console.log('✅ Webhook signature validation successful');
      return { valid: true };

    } catch (hmacError) {
      console.error('❌ HMAC generation failed:', hmacError);
      return {
        valid: false,
        error: `HMAC generation failed: ${hmacError instanceof Error ? hmacError.message : String(hmacError)}`
      };
    }

  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error during signature verification'
    };
  }
}


export async function updateRefundStatus(
  orderstatus: string,
  refund: RefundRequest,
  refundDetails: any,
) {
  let refundResponse;
  if (orderstatus === 'REFUNDED' || orderstatus === 'PARTIAL_REFUNDED') {
    refundResponse = Refunds.approve(refund, {
      refundId: refundDetails.payment_info_data.refund_id,
      code: refundDetails.payment_info_data.payment_response_code,
      message: 'Refund Successfull, Details --> ' + JSON.stringify(refundDetails.data),
    });
  } else {
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
  // Add validation
  if (!pluralOrderId) {
    console.error('❌ getPluralOrderStatus called with undefined pluralOrderId');
    return { 
      isError: true, 
      status: 'INVALID_ORDER_ID', 
      data: { error_message: 'Order ID is required' } 
    };
  }

  console.log('🔍 Getting Plural order status for:', pluralOrderId);
  
  const pluralDetails: any = await getPluralPayments(pluralOrderId, keys);
  const paymentinfo = pluralDetails.data;
  
  if (pluralDetails.isError) {
    console.error('❌ Plural API error:', pluralDetails.data);
    return { 
      isError: true, 
      status: paymentinfo.error_message, 
      data: paymentinfo 
    };
  }

  console.log('✅ Plural order status response:', {
    status: paymentinfo.status,
    order_status: paymentinfo.order_data?.order_status
  });

  return { 
    isError: false, 
    status: paymentinfo.status || paymentinfo.order_data?.order_status,
    data: paymentinfo 
  };
}