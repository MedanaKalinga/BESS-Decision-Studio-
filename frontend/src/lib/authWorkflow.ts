export const ACCOUNT_CREATED_MESSAGE = "Account created successfully. Sign in to continue.";

export function registrationCompletion(email: string) {
  return {
    mode: "login" as const,
    email: email.trim().toLowerCase(),
    message: ACCOUNT_CREATED_MESSAGE,
  };
}
