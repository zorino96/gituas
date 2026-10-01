/**
 * The newsroom autopilot. Placeholder until the autopilot task lands: the background tick already
 * calls it after every ingest and classify, so wiring it in later changes nothing here.
 */
export async function runAutopilot(_tenantId: string): Promise<{ drafted: number; published: number }> {
  return { drafted: 0, published: 0 };
}
