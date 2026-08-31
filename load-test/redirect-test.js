import http from 'k6/http';
import { check } from 'k6';

export const options = {
    vus: 75,
    duration: '30s',
};

export default function () {
    const res = http.get(
        'https://url-shortner-mocha-nu.vercel.app/majboorv1',
        {
            redirects: false,
        }
    );

    if (res.status !== 302) {
        console.log(`FAILED STATUS: ${res.status}`);
    }

    check(res, {
        'status is 302': (r) => r.status === 302,
    });
}