import { Nullable } from '@src/types';
import { callCallback } from '@utils/functions.utils';

describe('Unit::Utils::Functions', () => {
  describe('callCallback', () => {
    it('should call the callback with the given parameters', (): void => {
      const expectedError: Error = Error();
      const expectedData = 'data';

      let calledCallback = false;
      const callback = (error: Nullable<Error> | undefined, data: Nullable<string> | undefined): void => {
        expect(error).toBe(expectedError);
        expect(data).toBe(expectedData);
        calledCallback = true;
      };

      callCallback<string>(callback, expectedError, expectedData);
      expect(calledCallback).toBe(true);
    });

    it('not throw an error', (): void => {
      expect((): void => callCallback(undefined)).not.toThrow();
    });
  });
});
