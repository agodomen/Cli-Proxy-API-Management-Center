import { isUsageServiceId, type UsageServiceInfo } from '@/external/services/api/usageService';

export const resolveUsageServiceLoginMode = (info?: UsageServiceInfo | null) => {
  const hostedByUsageService = isUsageServiceId(info?.service);
  return {
    hostedByUsageService,
    usageServiceNeedsSetup: hostedByUsageService && info?.configured !== true,
  };
};
