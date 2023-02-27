import { VBase } from '@vtex/api';

const pinelabsBucket = 'PINELABS';
export async function save(vbase: VBase, key: any, data: any, bucket: string = pinelabsBucket) {
  try {
    return await vbase.saveJSON<{ result: any }>(bucket, key, data).then((res) => res);
  } catch (e) {
    console.log({ e });
    return null;
  }
}

export async function fetch(vbase: VBase, key: any, bucket: string = pinelabsBucket) {
  try {
    return await vbase.getJSON<{ result: any }>(bucket, key).then((res) => res);
  } catch (e) {
    // console.log( 'vbase Error',e.response );
    return { isError: true, data: e.response?.data };
  }
}

const pinelabsOrdersBucket = 'PINELABS_ORDERS';
export const saveOrderVBase = async (vbase: VBase, orderId: string, data: any) => {
  console.log('saveOrderVBase', { orderId, data });
  return save(vbase, orderId, data, pinelabsOrdersBucket);
};
export const getOrderVBase = async (vbase: VBase, orderId: string) => {
  return fetch(vbase, orderId, pinelabsOrdersBucket);
};
