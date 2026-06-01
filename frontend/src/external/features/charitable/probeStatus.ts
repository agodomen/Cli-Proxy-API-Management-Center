interface ProbeStatusResult {
  valid: boolean;
  skipped?: boolean;
  statusCode?: number;
}

export function isManualDetailedInvalidStatus(status: number): boolean {
  return status >= -99 && status < -1;
}

export function getProbeStatusAfterResult(
  currentStatus: number,
  result: ProbeStatusResult
): number | null {
  if (result.skipped || isManualDetailedInvalidStatus(currentStatus)) return null;

  const statusCode = result.statusCode;
  if (result.valid) {
    if (currentStatus === -1) return 0;
    return statusCode && statusCode >= 200 && statusCode < 300 ? statusCode : 1;
  }

  if (statusCode && statusCode >= 100 && statusCode <= 999) {
    if (statusCode >= 200 && statusCode < 300) return 0;
    return -statusCode;
  }
  return 0;
}
