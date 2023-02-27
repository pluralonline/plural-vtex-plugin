export const constants = {
  INCOMING_API: {
    AUTHORIZE: "AUTHORIZE",
    UPDATE_PAYMENT_STATUS: "UPDATE_PAYMENT_STATUS",
    PAYMENT_WEBHOOKS: "PAYMENT_WEBHOOKS",
    REFUND_WEBHOOKS: "REFUND_WEBHOOKS"
  },
  PLURAL: {
    BASE_URL_STAGING: "https://api-staging.pluralonline.com",
    BASE_URL_PROD: "https://api.pluralonline.com",
    SCRIPT_URL_STAGING:
      "https://checkout-staging.pluralonline.com/v1/web-sdk-checkout.js",
    SCRIPT_URL_PROD: "https://checkout.pluralonline.com/v1/web-sdk-checkout.js",
    STATUS:{
      ORDER_ATTEMPTED:"ORDER_ATTEMPTED",
      FAILED:"FAILED"
    }
  },
  whirlpool: {
    EMPLOYEE_CUS_CLASS: "OB",
  },
  masterdata: {
    USER_DATA_ENTITY: "CL",
    FIELDS: ["customerClass", "email"],
    DATA_ENTITY: "pinelab",
    SCHEMA: "paymentdetails",
    SCHEMA_BODY: {
      properties: {
        vtexOrderId: {
          type: "string",
          title: "Vtex Order Id",
        },
        vtexPaymentId: {
          type: "string",
          title: "Vtex Payment Id",
        },
        pluralOrderId: {
          type: "string",
          title: "checkout payment id",
        },
        pluralPaymentId: {
          type: "string",
          title: "checkout payment id",
        },
        callbackUrl: {
          type: "string",
          title: "Vtex callback URL",
        },
        status: {
          type: "boolean",
          title: "Refund Status of the payment",
        },
        pinelabsPaymentStatus: {
          type: "string",
          title: "Pinelabs payment status",
        },
        items: {
          type: "object",
          title: "All the items individual data with total price",
        },
      },
      "v-indexed": [
        "vtexOrderId",
        "vtexPaymentId",
        "pluralOrderId",
        "pluralPaymentId",
        "callbackUrl",
        "status",
        "pinelabsPaymentStatus",
      ],
      "v-security": {
        allowGetAll: false,
        publicRead: [
          "vtexOrderId",
          "vtexPaymentId",
          "pluralOrderId",
          "pluralPaymentId",
          "callbackUrl",
          "status",
          "pinelabsPaymentStatus",
          "items",
          "id",
        ],
        publicWrite: [
          "vtexOrderId",
          "vtexPaymentId",
          "pluralOrderId",
          "pluralPaymentId",
          "callbackUrl",
          "status",
          "pinelabsPaymentStatus",
          "items",
        ],
        publicFilter: [
          "vtexOrderId",
          "vtexPaymentId",
          "pluralOrderId",
          "pluralPaymentId",
          "callbackUrl",
          "status",
          "pinelabsPaymentStatus",
          "items",
        ],
      },
    },
  },
  scheduler: {
    body: {
      wakeup: true,
    },
  },
};
