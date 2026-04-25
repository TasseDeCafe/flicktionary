// these codes are returned from our backend, meaning they're public
// most of the time we return them to the user if our backend had an unexpected error (500), the user should not know
// what they mean because of potential security threats (hackers should now what a given 500 code means). On the other hand
// when the debugging, these codes are quite useful for nicer DX
// each of these codes should be used only once in the entire codebase
export const CrypticCodeConstants = {
  REMOVAL_ACCOUNT_NOT_INITIATED: '2030',
  REMOVAL_ACCOUNT_STRIPE_CANCEL_FAILED: '2040',
  REMOVAL_ACCOUNT_AUTH_USERS_DELETE_FAILED: '2070',
  REMOVAL_UPDATE_SUCCESS_FAILED: '2080',
}
