export function codedError(code, params, message) {
  const err = new Error(message);
  err.skCode = code;
  err.skParams = params || null;
  return err;
}
