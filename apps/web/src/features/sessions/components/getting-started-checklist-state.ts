export const shouldHideGettingStartedChecklist = ({
  retired,
  flagsResolved,
  statusResolved,
  allDone,
  mutationPending,
  mutationSucceeded,
}: {
  retired: boolean
  flagsResolved: boolean
  statusResolved: boolean
  allDone: boolean
  mutationPending: boolean
  mutationSucceeded: boolean
}): boolean => retired || !flagsResolved || !statusResolved || allDone || mutationPending || mutationSucceeded
