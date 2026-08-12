import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyArrayList,
  classifyFirebaseStorageList,
  classifyS3List,
  extractPostgrestTableCandidates,
  providerQuotaIdentity,
  sensitiveMaterialFields,
} from '../lib/provider-evidence';

test('PostgREST discovery prioritizes sensitive-looking readable tables', () => {
  const document = JSON.stringify({
    swagger: '2.0',
    paths: {
      '/public_posts': { get: {} },
      '/profiles': { get: {}, post: {} },
      '/audit_events': { get: {} },
      '/rpc/search_users': { post: {} },
    },
    definitions: {
      public_posts: { properties: { id: {}, title: {} } },
      profiles: { properties: { id: {}, email: {}, stripe_customer_id: {} } },
      audit_events: { properties: { id: {}, action: {} } },
    },
  });

  assert.deepEqual(extractPostgrestTableCandidates(document, 2), ['profiles', 'public_posts']);
});

test('OpenAPI 3 schemas are supported without accepting RPC or write-only paths', () => {
  const document = JSON.stringify({
    openapi: '3.0.0',
    paths: {
      '/notes': { get: {} },
      '/accounts': { get: {} },
      '/write_only': { post: {} },
      '/rpc/reset_password': { get: {} },
      '/nested/path': { get: {} },
    },
    components: {
      schemas: {
        notes: { properties: { body: {} } },
        accounts: { properties: { owner_id: {}, billing_address: {} } },
      },
    },
  });

  assert.deepEqual(extractPostgrestTableCandidates(document), ['accounts', 'notes']);
});

test('provider discovery is bounded and rejects unrelated or malformed responses', () => {
  assert.deepEqual(extractPostgrestTableCandidates('<html>not JSON</html>'), []);
  assert.deepEqual(extractPostgrestTableCandidates(JSON.stringify({ paths: { '/users': { get: {} } } })), []);

  const paths = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`/table_${index}`, { get: {} }]),
  );
  const document = JSON.stringify({ swagger: '2.0', paths });
  assert.equal(extractPostgrestTableCandidates(document, 100).length, 10);
  assert.deepEqual(extractPostgrestTableCandidates(document, 0), []);
});

test('provider quotas use validated project and bucket identities', () => {
  assert.equal(
    providerQuotaIdentity('https://abcdefghijklmnopqrst.supabase.co/rest/v1/posts'),
    'supabase-project:abcdefghijklmnopqrst.supabase.co',
  );
  assert.equal(
    providerQuotaIdentity('https://demo-default-rtdb.europe-west1.firebasedatabase.app/.json'),
    'firebase-database:demo-default-rtdb.europe-west1.firebasedatabase.app',
  );
  assert.equal(
    providerQuotaIdentity('https://firebasestorage.googleapis.com/v0/b/first.appspot.com/o?maxResults=1'),
    'firebase-storage:first.appspot.com',
  );
  assert.equal(
    providerQuotaIdentity('https://firebasestorage.googleapis.com/v0/b/second.appspot.com/o?maxResults=1'),
    'firebase-storage:second.appspot.com',
  );
  assert.equal(
    providerQuotaIdentity('https://assets.example.s3.eu-west-2.amazonaws.com/?list-type=2'),
    's3-bucket:assets.example',
  );
  assert.equal(
    providerQuotaIdentity('https://assets.example.s3.us-east-1.amazonaws.com/?list-type=2'),
    's3-bucket:assets.example',
    'regional aliases for one bucket share an allowance',
  );
});

test('shared provider hosts and malformed bucket paths are not quota targets', () => {
  assert.equal(providerQuotaIdentity('https://firebasestorage.googleapis.com/v0/b/not-a-provider/o'), null);
  assert.equal(providerQuotaIdentity('https://firebasestorage.googleapis.com/v0/b/a.appspot.com%2Fother/o'), null);
  assert.equal(providerQuotaIdentity('http://abcdefghijklmnopqrst.supabase.co/rest/v1/posts'), null);
  assert.equal(providerQuotaIdentity('https://s3.amazonaws.com/shared-bucket'), null);
  assert.equal(providerQuotaIdentity('https://example.com/data'), null);
});

test('empty and non-empty anonymous list responses are distinguished', () => {
  assert.equal(classifyArrayList([]), 'empty');
  assert.equal(classifyArrayList([{ name: 'redacted' }]), 'nonempty');
  assert.equal(classifyArrayList({}), null);

  assert.equal(classifyFirebaseStorageList({}), 'empty');
  assert.equal(classifyFirebaseStorageList({ items: [] }), 'empty');
  assert.equal(classifyFirebaseStorageList({ items: [{}] }), 'nonempty');
  assert.equal(classifyFirebaseStorageList({ items: 'invalid' }), null);

  assert.equal(classifyS3List('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>'), 'empty');
  assert.equal(classifyS3List('<ListBucketResult><Contents><Key>x</Key></Contents></ListBucketResult>'), 'nonempty');
  assert.equal(classifyS3List('<ListBucketResult><Contents>'), null);
});

test('Supabase row severity requires material sensitive values', () => {
  assert.deepEqual(sensitiveMaterialFields({
    email: 'nobody@example.com', user_id: '', phone: '0000000000', secret: 'redacted',
  }), []);
  assert.deepEqual(
    sensitiveMaterialFields({ email: 'person@customer.co.uk', user_id: 'user-123', public_title: 'hello' }),
    ['email', 'user_id'],
  );
  assert.deepEqual(
    sensitiveMaterialFields({ password_hash: '***', billing_address: { city: 'London' } }),
    ['billing_address'],
  );
});
