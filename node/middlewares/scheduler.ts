

export async function unhealthyCheckScheduler(host: any, ctx: any) {
  const {
    clients: { schedulerClient },
    vtex:{
      storeUserAuthToken
    }
  } = ctx;
  console.log({storeUserAuthToken});
  
  const uri = `https://${host}/_v/vtexasia.connector-pinelabs/v1/paymentWebhook`;
  let listOfCronJobs= undefined;
  //
  //getting list of cron jobs
  try{
    listOfCronJobs = await schedulerClient.getCronJobs();
    console.log("ALL CRON JOBS  ", { listOfCronJobs });
  }catch(e){
    console.log('Error while getting cron jobs - ',e)
    listOfCronJobs = null
  }
  //
  //filering if the cron is already created with 'uri'
  const isActiveCron = listOfCronJobs
    ? listOfCronJobs.some((cron: any) => cron.request.uri.includes(uri))
    : null;
    console.log('IS CRON JOB EXISTS - ', isActiveCron)
  if (isActiveCron) {
    return "CRON ALREADY EXISTS";
  } else if (isActiveCron === null) {
    return "ERROR WHILE CHECKING IF CRON EXISTS";
  } else {
    try {
      const cron = await schedulerClient.createCronJob(uri);
      console.log("Cron Created Successfully : ", cron);
    } catch (e) {
      console.log("Issue while creating cron - ", e);
    }
  }

  return;
}
