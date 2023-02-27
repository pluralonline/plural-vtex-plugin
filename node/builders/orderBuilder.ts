import { getSKUReferenceCode } from "../middlewares/vtex";
import { PinelabsOrderProduct } from "../typings/pinelabs";
import { VtexOrderMiniCart } from "../typings/vtex";

export async function buildRequestPayload(
  body: any,
  keys: any,
  hostUrl: string,
  account: any,
  authToken: any,
  isEmployee: boolean
) {
  // const amount:number = body.value as number * 100;
  const phNoWithCounrtyCode = body.miniCart.buyer.phone.split("");
  const phoneNumber = phNoWithCounrtyCode
    .reverse()
    .splice(0, 10)
    .reverse()
    .join("");
  // const countryCode = phNoWithCounrtyCode.reverse().splice(1, 2).join('');
  // console.log({ countryCode });
  const data = {
    merchant_data: {
      merchant_id: keys.merchantId,
      merchant_access_code: keys.accessCode,
      merchant_return_url: `https://${hostUrl}/_v/vtexasia.connector-pinelabs/v1/paymentWebhook`,
      merchant_order_id: body.orderId,
    },
    payment_info_data: {
      amount: Math.round(body.value * 100),
      currency_code: body.currency,
      order_desc: `Order from ${hostUrl}`,
    },
    customer_data: {
      country_code: "91",
      mobile_number: phoneNumber,
      email_id: body.miniCart.buyer.email,
    },
    billing_address_data: {
      first_name: body.miniCart.buyer.firstName,
      last_name: body.miniCart.buyer.lastName,
      address1: body.miniCart.billingAddress.street,
      address2: "",
      address3: "",
      // pin_code: body.miniCart.billingAddress.postalCode,
      pin_code: "500013",
      city: body.miniCart.billingAddress.city,
      state: body.miniCart.billingAddress.state,
      country: body.miniCart.billingAddress.india,
    },
    shipping_address_data: {
      first_name: body.miniCart.buyer.firstName,
      last_name: body.miniCart.buyer.lastName,
      address1: body.miniCart.shippingAddress.street,
      address2: "",
      address3: "",
      // pin_code: body.miniCart.shippingAddress.postalCode,
      pin_code: "500013",
      city: body.miniCart.shippingAddress.city,
      state: body.miniCart.shippingAddress.state,
      country: body.miniCart.shippingAddress.country,
    },
    product_info_data: {
      product_details: await buildProductDetails(
        body.miniCart,
        account,
        authToken,
        isEmployee
      ),
    },
    additional_info_data: {
      rfu1: "123",
    },
  };
  return data;
}

async function buildProductDetails(
  miniCart: VtexOrderMiniCart,
  account: any,
  authToken: any,
  isEmployee: boolean
) {
  let products: PinelabsOrderProduct[] = [];
  let skuRefId = "";

  for (let item of miniCart.items) {
    let productPrice = Math.round(
      ((item.price * item.quantity - Math.abs(item.discount)) / item.quantity) *
        100
    );

    for (let i = 0; i < item.quantity; i++) {
      skuRefId = await getSKUReferenceCode(
        item.id,
        account,
        authToken,
        isEmployee
      );
      console.log("REFERENCE CODE > ", skuRefId);

      if (!skuRefId) break;
      products.push({
        product_code: skuRefId,
        product_amount: productPrice,
      });
    }
  }

  if (miniCart.shippingValue) {
    products.push({
      product_code: "shipping",
      product_amount: Math.round(miniCart.shippingValue * 100),
    });
  }

  if (miniCart.taxValue) {
    products.push({
      product_code: "tax",
      product_amount: Math.round(miniCart.taxValue * 100),
    });
  }

  return products;
}

export async function buildHeader(hash256: any, keys: any) {
  const base64 = Buffer.from(keys.merchantId + ":" + keys.accessCode).toString(
    "base64"
  );
  return {
    "x-verify": hash256,
    Authorization: "Basic " + base64,
    Accept: "application/json",
    "Content-Type": "application/json",
    "cache-control": "no-cache",
  };
}

export async function buildOrderHeader(keys: any) {
  const base64 = Buffer.from(keys.merchantId + ":" + keys.accessCode).toString(
    "base64"
  );
  const headers = {
    Authorization: "Basic " + base64,
  };
  return headers;
}
