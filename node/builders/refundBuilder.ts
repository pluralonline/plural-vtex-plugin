const { v4: uuidv4 } = require('uuid');

export async function createRefundBuilder(orderDetails: any, keys: any, amount: number) {
    const payload = {
        "unique_txn_id": uuidv4(),
        "amount_in_paise": Math.round((amount ? amount : orderDetails.items.total) * 100),
        "merchant_id": parseInt(keys.merchantId),
        "order_id": parseInt(orderDetails.pluralOrderId),
        "payment_id": parseInt(orderDetails.pluralPaymentId)
    };

    return payload;
}


export async function buildRefundHeader(hash: any, keys: any) {
    const base64 = Buffer.from(keys.merchantId + ':' + keys.accessCode).toString('base64');
    console.log({base64})
    const header = {
        'x-verify': hash,
        'Authorization': 'Basic ' + base64
    }
    console.log({header})
    return header;
}
