import { unhealthyCheckScheduler } from "../middlewares/scheduler";
import { getAppSettings } from "./app-settings";

export const configureUnhealthyScheduler = async (
  _authorization: any,
  ctx: any
) => {
  const appSettings = await getAppSettings(ctx.clients.apps);
  let host = appSettings.site_url;

  if (host) {
    host = host.replace("https://", "").replace("http://", "");
    if (host.endsWith("/")) {
      host = host.substring(0, host.length - 1);
    }
  } else {
    host = ctx.req.headers["x-forwarded-host"];
  }
  await unhealthyCheckScheduler(host, ctx);
};
