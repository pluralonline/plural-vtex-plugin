import { InstanceOptions, IOContext, JanusClient } from "@vtex/api";
import { constants } from "../utils/constant";

export default class SchedulerClient extends JanusClient {
    constructor(ctx: IOContext, options?: InstanceOptions) {
      super( ctx, {
        ...options,
        headers: {
          ...options?.headers,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Vtex-Use-Https": "true",
          VtexIdclientAutCookie: ctx.authToken,
        },
      });
    }
  
    public async getCronJobs(): Promise<any> {
      return this.http.get(
        `/api/scheduler/master/vtexasia.connector-pinelabs?version=4`,
        { metric: 'scheduler-view-schedule' }
      );
    }
  
    public async createCronJob(uri:any): Promise<any> {
      return this.http.post(
        `/api/scheduler/master/vtexasia.connector-pinelabs?version=4`,{
          request: {
            uri: uri,
            method: "POST",
            headers: null,
            body: constants.scheduler.body,
          },
          scheduler: {
            endDate: "2025-01-01T00:00:00+00:00",
            expression: "* * * * *",
          },
        }
      );
    }
  }
  