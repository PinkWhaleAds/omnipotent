import { FastifyInstance, FastifyReply, FastifyRequest, FastifySchemaValidationError } from 'fastify';

import { UploadedAsset } from '@services';
import {
  IdParam,
  ListAssetsQuery,
  SetLabelsBody,
  UpdateAssetBody,
  UploadAssetFields,
  uploadAssetFieldsSchema,
} from '@src/types';
import { actorOf, httpError, organizationIdOf, toValidationError } from '@utils';
import { z } from 'zod';

/** Name of the file part of an upload. */
const FILE_FIELD = 'file';

/** What a multipart upload carried. */
type UploadParts = {
  /** The file part, when it was sent. */
  file?: { fileName: string; mimeType: string; data: Buffer };
  /** The text fields beside it, as they arrived. */
  fields: Record<string, string>;
};

/**
 * Read every part of a multipart upload, in whatever order they come.
 *
 * Each file part is read to the end (the next one only arrives once it is), but only the one named
 * `file` is kept. A file over the limit makes `toBuffer()` throw a 413, left to the error handler.
 *
 * @param request - The upload request
 * @returns The file part and the text fields
 * @throws Error with status 415 when the body is not `multipart/form-data`, 413 above the size limits
 */
async function readUploadParts(request: FastifyRequest): Promise<UploadParts> {
  if (!request.isMultipart()) {
    throw httpError(415, 'The body must be multipart/form-data', { code: 'multipart_required' });
  }

  const upload: UploadParts = { fields: {} };
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const data: Buffer = await part.toBuffer();
      if (part.fieldname === FILE_FIELD) {
        upload.file = { fileName: part.filename, mimeType: part.mimetype, data };
      }
    } else {
      upload.fields[part.fieldname] = String(part.value);
    }
  }
  return upload;
}

/**
 * Refuse a part of the upload the way the route's schema refuses a JSON body.
 *
 * The parts do not travel through that schema — a multipart body is not validated by it — so the
 * refusal is **shaped like Fastify's** and handed to the error handler, which names the field, the
 * rule and the location in the single error shape. One formatting, one place.
 *
 * @param failure - What the validator said, as an AJV error
 * @returns Never
 * @throws The refusal, with status 400 and the validation context of a body
 */
function refuse(failure: FastifySchemaValidationError): never {
  const error = new Error(failure.message) as Error & {
    statusCode: number;
    validation: FastifySchemaValidationError[];
    validationContext: string;
  };
  error.statusCode = 400;
  error.validation = [failure];
  error.validationContext = 'body';
  throw error;
}

/**
 * Read the fields of an upload, refused the way a JSON body would be.
 *
 * @param fields - The text fields of the upload
 * @returns The fields, parsed
 * @throws Error with status 400, which the error handler turns into `validation_failed`
 */
function readUploadFields(fields: Record<string, string>): UploadAssetFields {
  const sent: Record<string, unknown> = { ...fields };
  if (typeof sent.labelIds === 'string') {
    try {
      sent.labelIds = JSON.parse(sent.labelIds) as unknown;
    } catch {
      refuse({
        keyword: 'type',
        instancePath: '/labelIds',
        schemaPath: '#',
        params: {},
        message: "The 'labelIds' field must be a JSON array of uuids",
      });
    }
  }
  const parsed: z.ZodSafeParseResult<UploadAssetFields> = uploadAssetFieldsSchema.safeParse(sent);
  if (!parsed.success) refuse(toValidationError(parsed.error.issues[0]));
  return parsed.data;
}

/**
 * Handler for `GET /advertisers/:id/assets`.
 *
 * @param request - The request, with the Advertiser id and the page
 * @param reply - The reply, sent with a page of assets
 * @returns A promise that resolves once the response has been sent
 */
export async function listAssets(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListAssetsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.assetService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /advertisers/:id/assets` (`multipart/form-data`).
 *
 * Answers **201** for bytes the library did not have, and **200** for bytes it already had: the
 * fingerprint makes an upload repeatable (`docs/phase-6.md` § 2).
 *
 * @param request - The request, with the Advertiser id and the multipart body
 * @param reply - The reply, sent with the asset
 * @returns A promise that resolves once the response has been sent
 * @throws Error with status 400 when the file part is missing
 */
export async function uploadAsset(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  const { file, fields }: UploadParts = await readUploadParts(request);
  if (!file) {
    refuse({
      keyword: 'required',
      instancePath: `/${FILE_FIELD}`,
      schemaPath: '#',
      params: {},
      message: `The '${FILE_FIELD}' part is required`,
    });
  }
  const parsed: UploadAssetFields = readUploadFields(fields);

  const uploaded: UploadedAsset = await this.assetService.upload(
    actorOf(request),
    organizationIdOf(request),
    request.params.id,
    { fileName: file.fileName, mimeType: file.mimeType, data: file.data, ...parsed }
  );
  reply.code(uploaded.created ? 201 : 200).send(uploaded.asset);
}

/**
 * Handler for `GET /assets/:id`.
 *
 * @param request - The request, with the asset id
 * @param reply - The reply, sent with the asset
 * @returns A promise that resolves once the response has been sent
 */
export async function getAsset(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.assetService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /assets/:id`.
 *
 * @param request - The request, with the asset id and the new name
 * @param reply - The reply, sent with the updated asset
 * @returns A promise that resolves once the response has been sent
 */
export async function updateAsset(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateAssetBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.assetService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /assets/:id`.
 *
 * @param request - The request, with the asset id
 * @param reply - The reply, sent with its id and when it was deleted
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteAsset(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.assetService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /assets/:id/restore`.
 *
 * @param request - The request, with the asset id
 * @param reply - The reply, sent with its id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreAsset(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.assetService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /assets/:id/labels`.
 *
 * @param request - The request, with the asset id and the complete set of Labels
 * @param reply - The reply, sent with the asset
 * @returns A promise that resolves once the response has been sent
 */
export async function setAssetLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.assetService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}
