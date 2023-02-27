const DATA_ENTITY = 'vtexasia_logs';
const SCHEMA = 'payment_connector';

export async function createLogsSchema(ctx: any) {
  const {
    clients: { masterdata },
  } = ctx;

  try {
    const schema = await masterdata.getSchema({
      dataEntity: DATA_ENTITY,
      schema: SCHEMA,
    });

    if (!schema) {
      await masterdata.createOrUpdateSchema({
        dataEntity: DATA_ENTITY,
        schemaName: SCHEMA,
        schemaBody: {
          properties: {
            orderId: {
              type: 'string',
              title: 'Vtex Order Id',
            },
            email: {
              type: 'string',
              title: 'User email',
            },
            message: {
              type: 'string',
              title: 'Message',
            },
            body: {
              type: 'string',
              title: 'Body',
            },
          },
          'v-indexed': ['orderId', 'email'],
          'v-security': {
            allowGetAll: false,
            publicRead: ['id', 'orderId', 'email', 'message', 'body'],
            publicWrite: ['orderId', 'email', 'message', 'body'],
            publicFilter: ['orderId', 'email', 'message', 'body'],
          },
        },
      });
    }

    return {
      isError: false,
    };
  } catch (e) {
    console.log(e.response);
    if (e.response.status === 304) {
      return { isError: false };
    }
    return {
      isError: true,
    };
  }
}

export async function addLog(
  ctx: any,
  log: {
    orderId: string | null;
    email: string | null;
    message: string | null;
    body: string | null;
  },
) {
  const {
    clients: { masterdata },
  } = ctx;

  console.log('ADD LOG', log);

  const result = await masterdata.createDocument({
    dataEntity: DATA_ENTITY,
    schema: SCHEMA,
    fields: {
      orderId: log.orderId ?? '',
      email: log.email ?? '',
      message: log.message ?? '',
      body: log.body ?? '',
    },
  });

  return result;
}
