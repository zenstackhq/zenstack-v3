export * from './provider';

import { postgresql } from './postgresql';
import { sqlite } from './sqlite';

export const providers = {
    postgresql,
    sqlite,
};
