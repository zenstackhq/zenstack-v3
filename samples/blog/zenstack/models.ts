//////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

/* eslint-disable */

import { schema as $schema, type SchemaType as $Schema } from "./schema";
import { type ModelResult as $ModelResult, type TypeDefResult as $TypeDefResult } from "@zenstackhq/runtime";
/**
 * User model
 *
 * Represents a user of the blog.
 */
export type User = $ModelResult<$Schema, "User">;
/**
 * Profile model
 */
export type Profile = $ModelResult<$Schema, "Profile">;
/**
 * Post model
 */
export type Post = $ModelResult<$Schema, "Post">;
export type CommonFields = $TypeDefResult<$Schema, "CommonFields">;
/**
 * User roles
 */
export const Role = $schema.enums.Role;
/**
 * User roles
 */
export type Role = (typeof Role)[keyof typeof Role];
