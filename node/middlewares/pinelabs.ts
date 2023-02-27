import { MasterData } from "@vtex/api";
import { RefundRequest } from "@vtex/payment-provider";
import axios from "axios";
import { buildOrderHeader } from "../builders/orderBuilder";
import {
  buildRefundHeader,
  createRefundBuilder
} from "../builders/refundBuilder";
import { addLog } from "../masterdata/logs";
import { getOrderDocument } from "../masterdata/orderSchema";
import { constants } from "../utils/constant";
import { hash } from "../utils/hash";
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

export async function getPluralPaymentById(
  pluralOrderId: string,
  pluralPaymentId: string,
  keys: any
) {
  const baseUrl = keys.baseUrl
  const inboundAPI = axios.create({
    baseURL: baseUrl ?? constants.PLURAL.BASE_URL_PROD,
    timeout: 15000,
  });

  const headers = await buildOrderHeader(keys);

  const response: any = await inboundAPI
    .get(`/api/v1/inquiry/order/${pluralOrderId}/payment/${pluralPaymentId}`, {
      headers,
    })
    .then((response) => {
      console.log(
        "Pinelabs Payment Details By Payment Id - Response -> ",
        response.data
      );
      return {
        isError: false,
        data: response.data,
      };
    })
    .catch((error) => {
      console.log(
        "Pinelabs Payment Details By Payment Id - Error -> ",
        error.response
      );
      return {
        isError: true,
        data: error.response,
      };
    });

  return response;
}

export async function getPluralPaymentByOrderId(
  pluralOrderId: string,
  keys: any
) {
  const baseUrl = keys.baseUrl ?? constants.PLURAL.BASE_URL_PROD
  const headers = await buildOrderHeader(keys);
  const response = await axios.get(`${baseUrl}/api/v1/inquiry/order/${pluralOrderId}`, {
    headers
  })
  .then(function (response) {
    // console.log(response);
    return {
      isError: false,
      data: response.data
    }
  }).catch((error)=>{
    // console.log(error);
    return {
      isError: true,
      data: error.response
    }
  });

  return response;
  
}

export async function getPluralPayments(
  pluralOrderId: any,
  keys:any
) {
  
  const baseUrl = keys.baseUrl ?? constants.PLURAL.BASE_URL_PROD
  const headers = await buildOrderHeader(keys);
  const response = await axios.get(`${baseUrl}/api/v1/inquiry/payment/all/order/${pluralOrderId}`, {
    headers
  })
  .then(function (response) {
    // console.log(response);
    return {
      isError: false,
      data: response.data
    }
  }).catch((error)=>{
    // console.log(error);
    return {
      isError: true,
      data: error.response.data
    }
  });

  return response;
  
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
  ctx :any,
  keys: any,
  type: string,
  id: string,
  amount: any,
  masterdata: MasterData
) {
  //id depends on the state(type) of the payment either 'refund-cancel' Or 'return-items'
  //if 'refund-cancel' then id = vtexOrderId else if 'return-items' then id = vtexPaymentId
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
    message: "Refund Procedure - Get Order Doc from master data ",
    body: JSON.stringify(orderDetails.data),
  });

  const payload = await createRefundBuilder(orderDetails.data[0], keys, amount);
  console.log("Refund payload", payload);
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64"
  );
  const hash256OfEncodedPayload = await hash(encodedPayload, keys.secretCode);
  const headers = await buildRefundHeader(hash256OfEncodedPayload, keys);

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund Procedure - Refund Payload, hash256Encoded payload and headers",
    body: JSON.stringify({refundPayload:payload, hashedPayload:hash256OfEncodedPayload, refundHeaders: headers}),
  });

  const refundDetails = await refundPayment(keys.baseUrl,encodedPayload, headers);

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund Procedure - Refund Api request result",
    body: JSON.stringify(refundDetails),
  });

  let refund = <RefundRequest>{
    paymentId: orderDetails.data[0]?.vtexPaymentId,
    value: orderDetails.data[0]?.total,
  };

  console.log("before returning refund");

  if (
    refundDetails.isError &&
    refundDetails.data.data.error_message === "DUPLICATE_UNIQUE_ID_FOUND"
  ) {
    return {
      isError: false,
      data: refundDetails.data.data,
      message: "DUPLICATE_UNIQUE_ID_FOUND",
    };
  }

  console.log("after returning refund");

  if (refundDetails.isError) {
    addLog(ctx, {
      orderId: orderDetails.data[0]?.vtexOrderId,
      email: orderDetails.data[0]?.email ?? null,
      message: "Refund procedure - refund status CANCELLED udpdate",
      body: null,
    });
    return await updateRefundStatus("CANCELLED", refund, refundDetails.data);
  }

  addLog(ctx, {
    orderId: orderDetails.data[0]?.vtexOrderId,
    email: orderDetails.data[0]?.email ?? null,
    message: "Refund procedure - refund status - "+ refundDetails.data.order_data.order_status + " update",
    body: null,
  });
  return await updateRefundStatus(
    refundDetails.data.order_data.order_status,
    refund,
    refundDetails.data
  );
}
