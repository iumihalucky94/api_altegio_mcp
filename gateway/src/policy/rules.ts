export const DANGEROUS_ACTIONS = new Set<string>([
  'crm.cancel_appointment',
  'admin.cancel_appointment',
  'crm.apply_cancel_appointment',
  'payroll.apply_salary_result'
]);

export function isDeleteLikeAction(actionKey: string): boolean {
  if (DANGEROUS_ACTIONS.has(actionKey)) return true;
  return (
    actionKey.includes('cancel') ||
    actionKey.includes('delete') ||
    actionKey.includes('archive') ||
    actionKey.includes('remove')
  );
}

