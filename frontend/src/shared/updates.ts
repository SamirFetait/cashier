/**
 * What the main process reports about updates (IPC channel "update-status").
 *
 * The startup splash shows: checking -> downloading -> installing, or error,
 * then opening. While the app runs, the main window gets: checking,
 * available, downloading, downloaded, none or error.
 */
export type UpdateState =
  | "starting"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "none"
  | "error"
  | "opening";

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  /** 0-100, while downloading. */
  percent?: number;
  /** Bytes so far and in all, while downloading. */
  transferred?: number;
  total?: number;
}
