import http from 'k6/http';
import { check } from 'k6';

export const options = {
    vus: 10,
    duration: '30s',
};

export default function () {
    const res = http.get(
        'https://url-shortner-mocha-nu.vercel.app/githubv5',
        {
            redirects: false,
            timeout: '10s',
        }
    );

    if (res.status !== 302) {
        console.log(
            `FAILED | status=${res.status} | duration=${res.timings.duration}ms | body=${res.body}`
        );
    }

    check(res, {
        'status is 302': (r) => r.status === 302,
    });
}