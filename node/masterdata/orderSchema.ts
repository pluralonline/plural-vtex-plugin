import { MasterData } from '@vtex/api';
import { getAppSettings } from '../utils/app-settings';
import { constants } from '../utils/constant';

export async function createOrderDocument(body: any, customFields: any, masterdata: MasterData) {
  console.log({
    customFields,
  });

  let result: any = undefined;
  try {
    result = await masterdata.createDocument({
      dataEntity: constants.masterdata.DATA_ENTITY,
      schema: constants.masterdata.SCHEMA,
      fields: { ...body, pinelabsPaymentStatus: '' },
    });
  } catch (error) {
    console.error('Issue while creating the Document', error);
    return { isError: true, data: error.response.data };
  }

  return result;
}

export async function getOrderDocument(body: any, type: string, masterdata: MasterData) {
  let searchQuery;
  const fields = [
    'vtexOrderId',
    'vtexPaymentId',
    'pluralOrderId',
    'pluralPaymentId',
    'callbackUrl',
    'status',
    'pinelabsPaymentStatus',
    'items',
    'id',
    'createdIn',
  ];
  searchQuery =
    type === 'authorization'
      ? 'vtexOrderId="' + body + '"'
      : type === 'refund-items' || type === 'refund-cancel'
      ? 'vtexPaymentId="' + body + '"'
      : 'pluralOrderId="' + body + '"'; //search with GroupId

  let result: any = undefined;
  try {
    const documents = await masterdata.searchDocuments({
      dataEntity: constants.masterdata.DATA_ENTITY,
      schema: constants.masterdata.SCHEMA,
      fields,
      where: searchQuery,
      pagination: {
        page: 1,
        pageSize: 15,
      },
    });
    // console.log('SEARCH WHERE', searchQuery);
    // console.log('DOCUMENTS', documents);
    console.log('Get Document - Order details Success : ', documents);
    result = { isError: false, data: documents, searchQuery };
  } catch (error) {
    console.error('Get Document - Order details failure : ', error);
    return { isError: true, data: error, searchQuery };
  }

  return result;
}

export async function partialOrderDocumentUpdate(
  documentId: any,
  newValues: { field: string; value: any }[],
  masterdata: MasterData,
) {
  // console.log('Updating partial document!', { documentId, account, authToken });

  let data: any = {};

  for (let value of newValues) {
    data[value.field] = value.value;
  }

  try {
    const result = await masterdata.updatePartialDocument({
      dataEntity: constants.masterdata.DATA_ENTITY,
      schema: constants.masterdata.SCHEMA,
      id: documentId,
      fields: data,
    });

    return { isError: false, data: result };
  } catch (error) {
    return { isError: false, data: error };
  }
}

export async function createCheckoutOrderSchema(ctx: any) {
  const {
    clients: { apps, masterdata },
    vtex: { logger },
  } = ctx;
  const appSettings = await getAppSettings(apps);
  console.log({ appSettings });

  let result;
  let isSchemaPresent = true;
  try {
    const schema = await masterdata.getSchema({
      dataEntity: constants.masterdata.DATA_ENTITY,
      schema: constants.masterdata.SCHEMA,
    });

    if (!schema) {
      isSchemaPresent = false;
      result = await masterdata.createOrUpdateSchema({
        dataEntity: constants.masterdata.DATA_ENTITY ?? 'checkout',
        schemaName: constants.masterdata.SCHEMA,
        schemaBody: constants.masterdata.SCHEMA_BODY,
      });
    }

    isSchemaPresent
      ? logger.info('Schema is already created ---> ', schema)
      : logger.info('New Schema Created ---> ', result);

    return {
      isError: false,
      payload: result,
    };
  } catch (e) {
    logger.error('Issue while create or update of schema : ', e.response);
    if (e.response.status === 304) {
      return { isError: false, error: e };
    }
    return {
      isError: true,
      error: e,
    };
  }
}
