/** Original provider transfer result contract; no credentials cross this port. */
export interface OfflineTask { taskId?: string; fileId?: string }
export interface OfflineTaskStatus { completed: boolean; failed: boolean; message?: string }
