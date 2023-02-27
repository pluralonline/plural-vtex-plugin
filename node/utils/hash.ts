import { createHmac } from "crypto";

export async function hash(body: any, secretKey: any) {
  return createHmac("sha256", Buffer.from(secretKey, "hex"))
    .update(body)
    .digest("hex");
}
