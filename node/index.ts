import { PaymentProviderService } from "@vtex/payment-provider";

import { ClientsConfig, LRUCache, method, RecorderState, ServiceContext } from "@vtex/api";
import { Clients } from "./clients";
import PineLabs from "./connector";
import { createCheckoutOrderSchema } from "./masterdata/orderSchema";
import { paymentWebhook, updatePaymentStatus } from "./middlewares/vtex";

const TIMEOUT_MS = 800

// Create a LRU memory cache for the Status client.
// The @vtex/api HttpClient respects Cache-Control headers and uses the provided cache.
const memoryCache = new LRUCache<string, any>({ max: 5000 })

metrics.trackCache('status', memoryCache)

// This is the configuration for clients available in `ctx.clients`.
const clients: ClientsConfig<Clients> = {
  // We pass our custom implementation of the clients bag, containing the Status client.
  implementation: Clients,
  options: {
    // All IO Clients will be initialized with these options, unless otherwise specified.
    default: {
      retries: 2,
      timeout: TIMEOUT_MS,
    },
    // This key will be merged with the default options and add this cache to our Status client.
    status: {
      memoryCache,
    },
  },
}

declare global {
  // We declare a global Context type just to avoid re-writing ServiceContext<Clients, State> in every handler and resolver
  type Context = ServiceContext<Clients, State>

  // The shape of our State object found in `ctx.state`. This is used as state bag to communicate between middlewares.
  interface State extends RecorderState {
    code: number
  }
}

export default new PaymentProviderService({
  connector: PineLabs,
  clients,
  routes: {
    createOrderSchema: method({
      GET: [createCheckoutOrderSchema],
    }),
    paymentStatus: method({
      POST: [updatePaymentStatus],
    }),
    paymentWebhook: method({
      POST: [paymentWebhook],
    }),
  },
});
