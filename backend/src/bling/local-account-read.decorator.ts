import { SetMetadata } from '@nestjs/common';

export const LOCAL_ACCOUNT_READ = 'bling:local-account-read';
// Only for local reads that neither call Bling nor mutate the account/tokens.
export const LocalAccountRead = () => SetMetadata(LOCAL_ACCOUNT_READ, true);
