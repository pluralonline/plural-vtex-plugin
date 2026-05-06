import { MasterData } from "@vtex/api";
import { RefundRequest } from "@vtex/payment-provider";
import axios from "axios";
//import { buildOrderHeader } from "../builders/orderBuilder";
//import {buildRefundHeader,createRefundBuilder} from "../builders/refundBuilder";
import { addLog } from "../masterdata/logs";
import { getOrderDocument } from "../masterdata/orderSchema";
import { constants } from "../utils/constant";
//import { hash } from "../utils/hash";
import { updateRefundStatus } from "./vtex"; 


export async function createOrderPinelabs(
  baseUrl:string,
  encodedPayload: string,
  headers: any
) {
  console.log({baseUrl});
  
  const inboundAPI = axios.create({
    baseURL: baseUrl ?? constants.PLURAL.BASE_URL_PROD,
    timeout: 15000,
    headers: headers,
  });
  const data = {
    request: encodedPayload,
  };

  const response: any = await inboundAPI
    .post("/api/v1/order/create", data)
    .then((response) => {
      console.log("Pinelabs Create Order - Response -> ", response.data);
      return {
        isError: false,
        data: response.data,
      };
    })
    .catch((error) => {
      console.log("Pinelabs Create Order - Error -> ", JSON.stringify(error.response.data));
      return {
        isError: true,
        data: error.response.data,
      };
    });

  return response;
}



export async function createOrderPinelabsNew(
  baseUrl: string,
  payload: any,
  token: string
): Promise<{
  isError: boolean;
  data: any;
}> {
  console.log({ baseUrl });

  // Validate required fields
  if (!payload.merchant_order_reference) {
    return {
      isError: true,
      data: {
        error_code: "INVALID_REQUEST",
        error_message: "Merchant Order Reference Id is missing"
      }
    };
  }

  // Fix country code if needed
  if (payload.purchase_details?.customer?.shipping_address?.country === 'IND') {
    payload.purchase_details.customer.shipping_address.country = 'IN';
  }

  const inboundAPI = axios.create({
    baseURL: baseUrl,
    timeout: 15000,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
  });

  try {
    const response = await inboundAPI.post("/api/checkout/v1/orders", payload);
    console.log("Pinelabs Create Order - Response -> ", response.data);
    
    return {
      isError: false,
      data: response.data,
    };
  } catch (error) {
    console.log("Pinelabs Create Order - Error -> ", 
      axios.isAxiosError(error) ? JSON.stringify(error.response?.data) : error);
    
    return {
      isError: true,
      data: axios.isAxiosError(error) ? error.response?.data : { 
        error_code: "API_ERROR",
        error_message: error instanceof Error ? error.message : 'Unknown error' 
      },
    };
  }
}

export async function getAccessTokenPinelabs(
  baseUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ isError: boolean; data: any }> {
  const url = `${baseUrl}/api/auth/v1/token`;

  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    console.log('Pinelabs Access Token - Response ->', JSON.stringify(response.data, null, 2));
    
    return {
      isError: false,
      data: response.data, // includes access_token, expires_at, etc.
    };
  } catch (error) {
    const errorData = axios.isAxiosError(error) 
      ? error.response?.data 
      : error instanceof Error 
        ? error.message 
        : 'Unknown error';
    
    console.log('Pinelabs Access Token - Error ->', JSON.stringify(errorData, null, 2));
    
    return {
      isError: true,
      data: errorData,
    };
  }
}


export function buildNewOrderPayloadFromLegacyData(legacyPayload: any): any {
  const {
    merchant_data,
    payment_info_data,
    customer_data,
    billing_address_data,
    shipping_address_data,
    product_info_data,
    additional_info_data,
  } = legacyPayload;

  const newPayload: any = {
    merchant_order_reference: merchant_data?.merchant_order_id ?? `ORD_${Date.now()}`,
    order_amount: {
      value: payment_info_data?.amount ?? 0,
      currency: payment_info_data?.currency_code ?? 'INR',
    },
    callback_url: merchant_data?.merchant_return_url,
    integration_mode: 'IFRAME',
    pre_auth: false,
    purchase_details: {
      customer: {
        email_id: customer_data?.email_id ?? '',
        first_name: billing_address_data?.first_name ?? '',
        last_name: billing_address_data?.last_name ?? '',
        mobile_number: customer_data?.mobile_number ? customer_data.mobile_number : '',
        billing_address: {
          address1: billing_address_data?.address1 ?? '',
          pincode: billing_address_data?.pin_code ?? '',
          city: billing_address_data?.city ?? '',
          state: billing_address_data?.state ?? '',
          country: 'IN', // Assuming fixed
        },
        shipping_address: {
          address1: shipping_address_data?.address1 ?? '',
          pincode: shipping_address_data?.pin_code ?? '',
          city: shipping_address_data?.city ?? '',
          state: shipping_address_data?.state ?? '',
          country: shipping_address_data?.country ?? 'IN',
        },
      },
      products: product_info_data?.product_details?.map((product: any) => ({
        product_code: product?.product_code ?? 'DEFAULT',
        product_amount: {
          value: product?.product_amount ?? 0,
          currency: payment_info_data?.currency_code ?? 'INR',
        },
      })) ?? [],
    },
  };

  // Optional: Add discount if present in additional_info_data
  if (additional_info_data?.rfu1) {
    newPayload.purchase_details.cart_coupon_discount_amount = {
      value: parseInt(additional_info_data.rfu1, 10),
      currency: payment_info_data?.currency_code ?? 'INR',
    };
  }

  return newPayload;
}

export async function getPluralPaymentById(
  pluralOrderId: string,
  pluralPaymentId: string,
  keys: any
) {
  const orderResponse = await getPluralOrderDetails(pluralOrderId, keys);
  
  if (orderResponse.isError) {
    return orderResponse;
  }

  const payment = orderResponse.data.payments?.find(
    (p: any) => p.id === pluralPaymentId
  );

  if (!payment) {
    console.log(`Payment ${pluralPaymentId} not found in order ${pluralOrderId}`);
    return {
      isError: true,
      data: {
        error_code: "PAYMENT_NOT_FOUND",
        error_message: `Payment ${pluralPaymentId} not found in order ${pluralOrderId}`
      }
    };
  }

  return {
    isError: false,
    data: {
      ...orderResponse.data,
      payment_data: payment
    }
  };
}

export async function getPluralPaymentByOrderId(
  pluralOrderId: string,
  keys: any
) {
  return getPluralOrderDetails(pluralOrderId, keys);
}

export async function getPluralPayments(
  pluralOrderId: string,
  keys: any
) {
  const response = await getPluralOrderDetails(pluralOrderId, keys);
  
  if (response.isError) {
    return response;
  }

  return {
    ...response,
    data: {
      ...response.data,
      payments: response.data.payments || []
    }
  };
}

// Common internal function to fetch order details with retry
async function getPluralOrderDetails(
  pluralOrderId: string,
  keys: any
) {
  const baseUrl = keys.baseUrl ?? constants.PLURAL.BASE_URL_PROD;
  const maxRetries = 2;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. First get the access token
      const tokenResponse = await getAccessTokenPinelabs(
        baseUrl,
        keys.accessCode, 
        keys.secretCode
      );

      if (tokenResponse.isError) {
        console.error(`Token generation failed (attempt ${attempt}/${maxRetries}):`, tokenResponse.data);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        throw new Error(`Token generation failed: ${JSON.stringify(tokenResponse.data)}`);
      }

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        throw new Error('Access token not returned in response');
      }

      // 2. Make the API request with the fresh token
      const response = await axios.get(`${baseUrl}/api/pay/v1/orders/${pluralOrderId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (!response.data?.data) {
        throw new Error('Invalid response structure - missing data');
      }

      console.log("Pinelabs Order Details - Response ->", response.data);
      return {
        isError: false,
        data: response.data.data
      };
    } catch (error) {
      const errorDetails = {
        message: error.message,
        code: error.response?.status,
        data: error.response?.data,
        attempt: attempt,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };

      console.error(`Pinelabs Order Details Error (attempt ${attempt}/${maxRetries}):`, {
        pluralOrderId,
        error: errorDetails
      });

      // If not last attempt and it's a network error, retry
      if (attempt < maxRetries && !error.response?.status) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      return {
        isError: true,
        data: error.response?.data || {
          error_code: "API_ERROR",
          error_message: error.message,
          details: errorDetails
        }
      };
    }
  }
}

export async function refundPayment(baseUrl:string,encodedPayload: any, headers: any) {
  const inboundAPI = axios.create({
    baseURL: baseUrl ?? constants.PLURAL.BASE_URL_PROD,
    timeout: 15000,
    headers: headers,
  });

  const data = {
    request: encodedPayload,
  };

  const result: any = await inboundAPI
    .post(`/api/v1/refunds/payment/refund`, data)
    .then((response) => {
      console.log(
        "Pinelabs Refund Payment - Response -> ",
        JSON.stringify(response.data)
      );
      return {
        isError: false,
        data: response.data,
      };
    })
    .catch((error) => {
      console.log("Pinelabs Refund Payment - Error -> ", error.response.data);
      return {
        isError: true,
        data: error.response,
      };
    });

  return result;
}

export async function refundProcedure(
  ctx: any,
  keys: any,
  type: string,
  id: string,
  amount: any,
  masterdata: MasterData
) {
  // Get order details from masterdata
  const orderDetails = await getOrderDocument(id, type, masterdata);
  console.log('Order Details Master data : ', orderDetails.data);

  if (!orderDetails.data.length) {
    return {
      isError: false,
      data: orderDetails.data,
      message: "NO_ORDER_DETAILS_FOUND",
    };
  }

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund Procedure - Get Order Doc from master data",
    body: JSON.stringify(orderDetails.data),
  });

  // Get access token first
  const tokenResponse = await getAccessTokenPinelabs(keys.baseUrl, keys.accessCode, keys.secretCode);
  
  if (tokenResponse.isError) {
    addLog(ctx, {
      orderId: orderDetails.data[0]?.vtexOrderId,
      email: orderDetails.data[0]?.email ?? null,
      message: "Refund Procedure - Failed to get access token",
      body: JSON.stringify(tokenResponse.data),
    });
    
    return {
      isError: true,
      data: tokenResponse.data,
      message: "TOKEN_ERROR",
    };
  }

  // Prepare refund payload
  const refundPayload = {
    parent_order_id: orderDetails.data[0]?.pluralOrderId,
    merchant_order_reference: orderDetails.data[0]?.vtexOrderId,
    refund_reason: "Customer request",
    order_amount: {
      value: amount ?? orderDetails.data[0]?.items?.total,
      currency: "INR"
    }
  };

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund Procedure - Refund Payload",
    body: JSON.stringify(refundPayload),
  });

  // Call the new refund API
  const refundDetails = await refundPaymentNew(
    keys.baseUrl,
    refundPayload,
    tokenResponse.data.access_token
  );

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund Procedure - Refund Api request result",
    body: JSON.stringify(refundDetails),
  });

  let refund = <RefundRequest>{
    paymentId: orderDetails.data[0]?.vtexPaymentId,
    value: amount ?? orderDetails.data[0]?.items?.total,
  };

  if (refundDetails.isError) {
    if (refundDetails.data?.error_message?.includes("DUPLICATE")) {
      return {
        isError: false,
        data: refundDetails.data,
        message: "DUPLICATE_UNIQUE_ID_FOUND",
      };
    }

    addLog(ctx, {
      orderId: orderDetails.data[0]?.vtexOrderId,
      email: orderDetails.data[0]?.email ?? null,
      message: "Refund procedure - refund status CANCELLED update",
      body: null,
    });
    
    return await updateRefundStatus("CANCELLED", refund, refundDetails.data);
  }

  const refundStatus = refundDetails.data?.status || "PROCESSED";
  
  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: `Refund procedure - refund status - ${refundStatus} update`,
    body: null,
  });
  
  return await updateRefundStatus(
    refundStatus,
    refund,
    refundDetails.data
  );
}


export async function refundPaymentNew(
  baseUrl: string,
  payload: any,
  token: string
): Promise<{
  isError: boolean;
  data: any;
}> {
  try {
    // Validate required fields
    if (!payload.merchant_order_reference) {
      return {
        isError: true,
        data: {
          error_code: "INVALID_REQUEST",
          error_message: "Merchant Order Reference is missing"
        }
      };
    }

    const url = `${baseUrl}/api/pay/v1/refunds`;
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log("Pinelabs Refund Payment - Response -> ", response.data);
    
    return {
      isError: false,
      data: response.data.data // Return the data part of the response
    };
  } catch (error) {
    console.log("Pinelabs Refund Payment - Error -> ", 
      axios.isAxiosError(error) ? JSON.stringify(error.response?.data) : error);
    
    return {
      isError: true,
      data: axios.isAxiosError(error) ? error.response?.data : { 
        error_code: "API_ERROR",
        error_message: error instanceof Error ? error.message : 'Unknown error' 
      },
    };
  }
}
