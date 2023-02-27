export interface PinelabsWebhookBody {
  merchant_data: PinelabsWebhookMerchantData,
  order_data: PinelabsWebhookOrderData,
  payment_info_data: PinelabsWebhookPaymentInfoData,
  wakeup: boolean
}

export interface PinelabsWebhookMerchantData {
  merchant_id: number,
  order_id: string,
}

export interface PinelabsWebhookOrderData {
  plural_order_id: number,
  amount: number,
  currency_code: string,
  order_desc: string,
  order_status: string,
  refund_amount: number,
}

export interface PinelabsWebhookPaymentInfoData {
  payment_status: string,
  amount_in_paisa: string,
  payment_response_code: string,
  acquirer_name: string,
  payment_id: string,
  gateway_transaction_id: string,
  merchant_return_url: string,
  captured_amount_in_paisa: string,
  refund_amount_in_paisa: string,
  refund_id?: string,
}

export interface PinelabsOrderProduct {
  product_code: string,
  product_amount: number
}