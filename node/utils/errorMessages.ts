type PluralErrorMessageType = {
  error: string;
  message: string;
};

export const pluralErrorMessages: PluralErrorMessageType[] = [
  {
    error: 'NO_PAYMENT_FOUND_ON_THIS_ORDER_ID',
    message:
      'No payments were found in this order. This may be due to the user closing the payment modal without making a payment.',
  },
];

export const getPluralErrorMessage = (error: string) => {
  let message = 'Plural Error Message: ' + error;

  if (pluralErrorMessages.some((e) => e.error === error)) {
    message = pluralErrorMessages.find((e) => e.error === error)!.message;
  }

  return message;
};
