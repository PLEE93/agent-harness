export interface ResumeRequest {
  readonly sessionId: string;
}

export async function resumeSession(_request: ResumeRequest): Promise<never> {
  throw new Error("resumeSession is not implemented in this Phase 1 scaffold.");
}
