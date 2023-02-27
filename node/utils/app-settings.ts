export async function getAppSettings(apps: any) {
  const appId = process.env.VTEX_APP_ID as string;
  console.log({ appId });
  const settings = await apps.getAppSettings(appId);
  return settings;
}
