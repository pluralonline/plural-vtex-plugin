export interface VtexOrderMiniCart {
  items: VtexOrderMiniCartItem[],
  shippingValue: number,
  taxValue: number
}

export interface VtexOrderMiniCartItem {
  id:	string,
  name:	string,
  price:	number,
  quantity:	number,
  discount:	number,
  deliveryType:	string,
  categoryId:	string,
  sellerId:	string,
  taxValue:	number,
  taxRate: number
}

export interface Keys{
  publicKey:string,
  secretKey:string,
  merchantId:string,
  accessCode:string,
  secretCode:string,
  baseUrl:string,
  pluralScriptUrl:string
}