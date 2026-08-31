import http from 'k6/http';
import { check } from 'k6';

export const options = {
    vus: 50,
    duration: '30s',
    httpReqTimeout: '10s',
};

export default function () {
    const res = http.get(
        'https://url-shortner-mocha-nu.vercel.app/majboorv1',
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