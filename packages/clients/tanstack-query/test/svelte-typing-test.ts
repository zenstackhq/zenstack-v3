import { get } from 'svelte/store';
import { useClientQueries } from '../src/svelte';
import { schema } from './schemas/basic/schema-lite';

const client = useClientQueries(schema);

// @ts-expect-error missing args
client.user.useFindUnique();

check(get(client.user.useFindUnique({ where: { id: '1' } })).data?.email);
check(get(client.user.useFindUnique({ where: { id: '1' } })).queryKey);
check(get(client.user.useFindUnique({ where: { id: '1' } }, { optimisticUpdate: true, enabled: false })));

// @ts-expect-error unselected field
check(get(client.user.useFindUnique({ select: { email: true } })).data.name);

check(get(client.user.useFindUnique({ where: { id: '1' }, include: { posts: true } })).data?.posts[0]?.title);

check(get(client.user.useFindFirst()).data?.email);

check(get(client.user.useFindMany()).data?.[0]?.email);
check(get(client.user.useInfiniteFindMany()).data?.pages[0]?.[0]?.email);
check(
    get(
        client.user.useInfiniteFindMany(
            {},
            {
                getNextPageParam: () => ({ id: '2' }),
            },
        ),
    ).data?.pages[1]?.[0]?.email,
);

check(get(client.user.useCount()).data?.toFixed(2));
check(get(client.user.useCount({ select: { email: true } })).data?.email.toFixed(2));

check(get(client.user.useAggregate({ _max: { email: true } })).data?._max.email);

check(get(client.user.useGroupBy({ by: ['email'], _max: { name: true } })).data?.[0]?._max.name);

// @ts-expect-error missing args
client.user.useCreate().mutate();
get(client.user.useCreate()).mutate({ data: { email: 'test@example.com' } });
get(client.user.useCreate({ optimisticUpdate: true, invalidateQueries: false, retry: 3 })).mutate({
    data: { email: 'test@example.com' },
});

get(client.user.useCreate())
    .mutateAsync({ data: { email: 'test@example.com' }, include: { posts: true } })
    .then((d) => check(d.posts[0]?.title));

get(client.user.useCreateMany())
    .mutateAsync({
        data: [{ email: 'test@example.com' }, { email: 'test2@example.com' }],
        skipDuplicates: true,
    })
    .then((d) => d.count);

get(client.user.useCreateManyAndReturn())
    .mutateAsync({
        data: [{ email: 'test@example.com' }],
    })
    .then((d) => check(d[0]?.name));

get(client.user.useCreateManyAndReturn())
    .mutateAsync({
        data: [{ email: 'test@example.com' }],
        select: { email: true },
    })
    // @ts-expect-error unselected field
    .then((d) => check(d[0].name));

get(client.user.useUpdate()).mutate(
    { data: { email: 'updated@example.com' }, where: { id: '1' } },
    {
        onSuccess: (d) => {
            check(d.email);
        },
    },
);

get(client.user.useUpdateMany()).mutate({ data: { email: 'updated@example.com' } });

get(client.user.useUpdateManyAndReturn())
    .mutateAsync({ data: { email: 'updated@example.com' } })
    .then((d) => check(d[0]?.email));

get(client.user.useUpsert()).mutate({
    where: { id: '1' },
    create: { email: 'new@example.com' },
    update: { email: 'updated@example.com' },
});

get(client.user.useDelete()).mutate({ where: { id: '1' }, include: { posts: true } });

get(client.user.useDeleteMany()).mutate({ where: { email: 'test@example.com' } });

function check(_value: unknown) {
    // noop
}

// @ts-expect-error delegate model
client.foo.useCreate();
client.foo.useUpdate();
client.bar.useCreate();
