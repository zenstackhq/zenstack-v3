import { describe, it } from 'vitest';
import { type Configuration, ShirtColor } from './models';

describe('Issue 204 regression tests', () => {
    it('tests issue 204', () => {
        const config: Configuration = { teamColors: [ShirtColor.Black, ShirtColor.Blue] };
        console.log(config.teamColors?.[0]);
        const config1: Configuration = {};
        console.log(config1);
    });
});
