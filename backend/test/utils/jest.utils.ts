/**
 * Sets a private (or otherwise inaccessible) property on an object.
 *
 * @param obj - The target object on which to set the property.
 * @param propertyName - The name of the property to set.
 * @param value - The value to assign to the property.
 * @returns Nothing.
 *
 * @example
 * ```typescript
 * setPrivateProperty(service, '_connectionTimeout', 5000);
 * ```
 */
export function setPrivateProperty<T>(obj: any, propertyName: string, value: T): void {
  obj[propertyName] = value;
}

/**
 * Retrieves a private (or otherwise inaccessible) property from an object.
 *
 * @param obj - The target object from which to read the property.
 * @param propertyName - The name of the property to read.
 * @returns The value of the property cast to the specified generic type.
 *
 * @example
 * ```typescript
 * const timeout = getPrivateProperty<number>(service, '_connectionTimeout');
 * ```
 */
export function getPrivateProperty<T = any>(obj: any, propertyName: string): T {
  return obj[propertyName];
}

/**
 * Creates a Jest spy on a private (or otherwise inaccessible) method of an object.
 *
 * @param obj - The target object containing the method to spy on.
 * @param methodName - The name of the method to spy on.
 * @returns A Jest SpyInstance attached to the specified method.
 *
 * @example
 * ```typescript
 * const spy = spyPrivateMethod(service, '_internalProcess');
 * service.run();
 * expect(spy).toHaveBeenCalled();
 * ```
 */
export function spyPrivateMethod(obj: any, methodName: string): jest.SpyInstance {
  return jest.spyOn(obj, methodName);
}

/**
 * Invokes a private (or otherwise inaccessible) method on an object and returns its result.
 *
 * @param obj - The target object containing the method to call.
 * @param methodName - The name of the method to invoke.
 * @param args - The arguments to pass to the method.
 * @returns The return value of the invoked method cast to the specified generic type.
 *
 * @example
 * ```typescript
 * const result = callPrivateMethod<string>(service, '_formatName', 'John', 'Doe');
 * ```
 */
export function callPrivateMethod<T>(obj: any, methodName: string, ...args: any[]): T {
  return obj[methodName](...args);
}

/**
 * Invokes a private (or otherwise inaccessible) asynchronous method on an object and returns its result.
 *
 * @param obj - The target object containing the async method to call.
 * @param methodName - The name of the async method to invoke.
 * @param args - The arguments to pass to the method.
 * @returns A Promise that resolves with the return value of the invoked method cast to the specified generic type.
 *
 * @example
 * ```typescript
 * const result = await callPrivateMethodAsync<string>(service, '_fetchData', requestId);
 * ```
 */
export async function callPrivateMethodAsync<T>(obj: any, methodName: string, ...args: any[]): Promise<T> {
  return await obj[methodName](...args);
}

/**
 * Creates a deep copy of an object using JSON serialization and deserialization.
 *
 * @param obj - The object to deep copy. Must be JSON-serializable.
 * @returns A new object that is a deep copy of the input.
 *
 * @example
 * ```typescript
 * const original = { nested: { value: 42 } };
 * const copy = deepCopy(original);
 * copy.nested.value = 99;
 * // original.nested.value is still 42
 * ```
 */
export function deepCopy<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
