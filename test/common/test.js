const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Nightmare = require('nightmare');
const walkSync = require('walk-sync');
const rimraf = require('rimraf');
const ports = require('port-authority');
const fetch = require('node-fetch');

Nightmare.action('page', {
	title(done) {
		this.evaluate_now(() => document.querySelector('h1').textContent, done);
	},

	html(done) {
		this.evaluate_now(() => document.documentElement.innerHTML, done);
	},

	text(done) {
		this.evaluate_now(() => document.body.textContent, done);
	}
});

Nightmare.action('init', function(done) {
	this.evaluate_now(() => window.init(), done);
});

Nightmare.action('prefetchRoutes', function(done) {
	this.evaluate_now(() => window.prefetchRoutes(), done);
});

const cli = path.resolve(__dirname, '../../sapper');

const wait = ms => new Promise(f => setTimeout(f, ms));

describe('sapper', function() {
	process.chdir(path.resolve(__dirname, '../app'));

	// clean up after previous test runs
	rimraf.sync('__sapper__');

	this.timeout(process.env.CI ? 30000 : 15000);

	// TODO reinstate dev tests
	// run({
	// 	mode: 'development'
	// });

	run({
		mode: 'production'
	});

	run({
		mode: 'production',
		basepath: '/custom-basepath'
	});

	testExport({});

	testExport({ basepath: '/custom-basepath' });
});

function testExport({ basepath = '' }) {
	describe(basepath ? `export --basepath ${basepath}` : 'export', () => {
		before(() => {
			if (basepath) {
				process.env.BASEPATH = basepath;
			}

			return exec(`node ${cli} export ${basepath ? `--basepath ${basepath}` : ''}`);
		});

		it('export all pages', () => {
			const dest = path.resolve(__dirname, '../app/__sapper__/export');

			// Pages that should show up in the extraction directory.
			const expectedPages = [
				'index.html',
				'about/index.html',
				'slow-preload/index.html',

				'redirect-from/index.html',
				'redirect-to/index.html',
				'non-sapper-redirect-from/index.html',
				'non-sapper-redirect-to/index.html',

				'blog/index.html',
				'blog/a-very-long-post/index.html',
				'blog/how-can-i-get-involved/index.html',
				'blog/how-is-sapper-different-from-next/index.html',
				'blog/how-to-use-sapper/index.html',
				'blog/what-is-sapper/index.html',
				'blog/why-the-name/index.html',
				'blog/encödïng-test/index.html',

				'blog.json',
				'blog/a-very-long-post.json',
				'blog/how-can-i-get-involved.json',
				'blog/how-is-sapper-different-from-next.json',
				'blog/how-to-use-sapper.json',
				'blog/what-is-sapper.json',
				'blog/why-the-name.json',
				'blog/encödïng-test.json',

				'favicon.png',
				'global.css',
				'great-success.png',
				'manifest.json',
				'service-worker.js',
				'svelte-logo-192.png',
				'svelte-logo-512.png',
			].map(file => {
				return basepath ? `${basepath.replace(/^[\/\\]/, '')}/${file}` : file;
			});

			// Client scripts that should show up in the extraction directory.
			const expectedClientRegexes = [
				/client\/[^/]+\/main(\.\d+)?\.js/,
				/client\/[^/]+\/index(\.\d+)?\.js/,
				/client\/[^/]+\/about(\.\d+)?\.js/,
				/client\/[^/]+\/blog_\$slug(\.\d+)?\.js/,
				/client\/[^/]+\/blog(\.\d+)?\.js/,
				/client\/[^/]+\/slow\$45preload(\.\d+)?\.js/,
			];
			const allPages = walkSync(dest);

			expectedPages.forEach((expectedPage) => {
				assert.ok(allPages.includes(expectedPage),`Could not find page matching ${expectedPage}`);
			});

			expectedClientRegexes.forEach((expectedRegex) => {
				// Ensure each client page regular expression matches at least one
				// generated page.
				let matched = false;
				for (const page of allPages) {
					if (expectedRegex.test(page)) {
						matched = true;
						break;
					}
				}
				assert.ok(matched, `Could not find client page matching ${expectedRegex}`);
			});
		});
	});
}

function run({ mode, basepath = '' }) {
	describe(`mode=${mode}`, function () {
		let proc;
		let capture;

		let base;
		let captured_basepath;

		const nightmare = new Nightmare();

		nightmare.on('console', (type, ...args) => {
			console[type](...args);
		});

		nightmare.on('page', (type, ...args) => {
			if (type === 'error') {
				console.error(args[1]);
			} else {
				console.warn(type, args);
			}
		});

		before(() => {
			const promise = mode === 'production'
				? exec(`node ${cli} build -l`).then(() => ports.find(3000))
				: ports.find(3000).then(port => {
					exec(`node ${cli} dev`);
					return ports.wait(port).then(() => port);
				});

			return promise.then(port => {
				base = `http://localhost:${port}`;
				if (basepath) base += basepath;

				const dir = mode === 'production' ? '__sapper__/build' : '__sapper__/dev';

				if (mode === 'production') {
					assert.ok(fs.existsSync('__sapper__/build/index.js'));
				}

				proc = require('child_process').fork(`${dir}/server/server.js`, {
					cwd: process.cwd(),
					env: {
						NODE_ENV: mode,
						BASEPATH: basepath,
						SAPPER_DEST: dir,
						PORT: port
					}
				});

				let handler;

				proc.on('message', message => {
					if (message.__sapper__) {
						if (message.event === 'basepath') {
							captured_basepath = basepath;
						}
						return;
					}

					if (handler) handler(message);
				});

				capture = fn => {
					return new Promise((fulfil, reject) => {
						const captured = [];

						let start = Date.now();

						handler = message => {
							if (message.type === 'ready') {
								fn().then(() => {
									proc.send({
										action: 'end'
									});
								}, reject);
							}

							else if (message.type === 'done') {
								fulfil(captured);
								handler = null;
							}

							else {
								captured.push(message);
							}
						};

						proc.send({
							action: 'start'
						});
					});
				};
			});
		});

		after(() => {
			// give a chance to clean up
			return Promise.all([
				nightmare.end(),
				new Promise(fulfil => {
					proc.on('exit', fulfil);
					proc.kill();
				})
			]);
		});

		describe('basic functionality', () => {
			it('serves /', () => {
				return nightmare.goto(base).page.title().then(title => {
					assert.equal(title, 'Great success!');
				});
			});

			it('serves /?', () => {
				return nightmare.goto(`${base}?`).page.title().then(title => {
					assert.equal(title, 'Great success!');
				});
			});

			it('serves static route', () => {
				return nightmare.goto(`${base}/about`).page.title().then(title => {
					assert.equal(title, 'About this site');
				});
			});

			it('serves dynamic route', () => {
				return nightmare.goto(`${base}/blog/what-is-sapper`).page.title().then(title => {
					assert.equal(title, 'What is Sapper?');
				});
			});

			it('navigates to a new page without reloading', () => {
				return nightmare.goto(base).init().prefetchRoutes()
					.then(() => {
						return capture(() => nightmare.click('a[href="about"]'));
					})
					.then(requests => {
						assert.deepEqual(requests.map(r => r.url), []);
					})
					.then(() => wait(100))
					.then(() => nightmare.path())
					.then(path => {
						assert.equal(path, `${basepath}/about`);
						return nightmare.title();
					})
					.then(title => {
						assert.equal(title, 'About');
					});
			});

			it('navigates programmatically', () => {
				return nightmare
					.goto(`${base}/about`)
					.init()
					.evaluate(() => window.goto('blog/what-is-sapper'))
					.title()
					.then(title => {
						assert.equal(title, 'What is Sapper?');
					});
			});

			it('prefetches programmatically', () => {
				return capture(() => nightmare.goto(`${base}/about`).init())
					.then(() => {
						return capture(() => {
							return nightmare
								.click('.prefetch')
								.wait(200);
						});
					})
					.then(requests => {
						assert.ok(!!requests.find(r => r.url === `/blog/why-the-name.json`));
					});
			});

			it('scrolls to active deeplink', () => {
				return nightmare
					.goto(`${base}/blog/a-very-long-post#four`)
					.init()
					.evaluate(() => window.scrollY)
					.then(scrollY => {
						assert.ok(scrollY > 0, scrollY);
					});
			});

			it.skip('reuses prefetch promise', () => {
				return nightmare
					.goto(`${base}/blog`)
					.init()
					.then(() => {
						return capture(() => {
							return nightmare
								.evaluate(() => {
									const a = document.querySelector('[href="blog/what-is-sapper"]');
									a.dispatchEvent(new MouseEvent('mousemove'));
								})
								.wait(200);
						});
					})
					.then(mouseover_requests => {
						assert.ok(mouseover_requests.findIndex(r => r.url === `/blog/what-is-sapper.json`) !== -1);

						return capture(() => {
							return nightmare
								.click('[href="blog/what-is-sapper"]')
								.wait(200);
						});
					})
					.then(click_requests => {
						assert.ok(click_requests.findIndex(r => r.url === `/blog/what-is-sapper.json`) === -1);
					});
			});

			it('cancels navigation if subsequent navigation occurs during preload', () => {
				return nightmare
					.goto(base)
					.init()
					.click('a[href="slow-preload"]')
					.wait(100)
					.click('a[href="about"]')
					.wait(100)
					.then(() => nightmare.path())
					.then(path => {
						assert.equal(path, `${basepath}/about`);
						return nightmare.title();
					})
					.then(title => {
						assert.equal(title, 'About');
						return nightmare.evaluate(() => window.fulfil({})).wait(100);
					})
					.then(() => nightmare.path())
					.then(path => {
						assert.equal(path, `${basepath}/about`);
						return nightmare.title();
					})
					.then(title => {
						assert.equal(title, 'About');
					});
			});

			it('calls a delete handler', () => {
				return nightmare
					.goto(`${base}/delete-test`)
					.init()
					.click('.del')
					.wait(() => window.deleted)
					.evaluate(() => window.deleted.id)
					.then(id => {
						assert.equal(id, 42);
					});
			});

			it('hydrates initial route', () => {
				return nightmare.goto(base)
					.wait('.hydrate-test')
					.evaluate(() => {
						window.el = document.querySelector('.hydrate-test');
					})
					.init()
					.evaluate(() => {
						return document.querySelector('.hydrate-test') === window.el;
					})
					.then(matches => {
						assert.ok(matches);
					});
			});

			it('redirects on server', () => {
				return nightmare.goto(`${base}/redirect-from`)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/redirect-to`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, 'redirected');
					});
			});

			it('redirects in client', () => {
				return nightmare.goto(base)
					.wait('[href="redirect-from"]')
					.click('[href="redirect-from"]')
					.wait(200)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/redirect-to`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, 'redirected');
					});
			});

			it('redirects on server (root)', () => {
				return nightmare.goto(`${base}/redirect-root`)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, 'Great success!');
					});
			});

			it('redirects in client (root)', () => {
				return nightmare.goto(base)
					.wait('[href="redirect-root"]')
					.click('[href="redirect-root"]')
					.wait(200)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, 'Great success!');
					});
			});

			it('handles 4xx error on server', () => {
				return nightmare.goto(`${base}/blog/nope`)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/blog/nope`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, '404')
					});
			});

			it('handles 4xx error in client', () => {
				return nightmare.goto(base)
					.init()
					.click('[href="blog/nope"]')
					.wait(200)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/blog/nope`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, '404');
					});
			});

			it('handles non-4xx error on server', () => {
				return nightmare.goto(`${base}/blog/throw-an-error`)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/blog/throw-an-error`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, '500')
					});
			});

			it('handles non-4xx error in client', () => {
				return nightmare.goto(base)
					.init()
					.click('[href="blog/throw-an-error"]')
					.wait(200)
					.path()
					.then(path => {
						assert.equal(path, `${basepath}/blog/throw-an-error`);
					})
					.then(() => nightmare.page.title())
					.then(title => {
						assert.equal(title, '500');
					});
			});

			// Ignores are meant for top-level escape.
			// ~> Sapper **should** own the entire {basepath} when designated.
			if (!basepath) {
				it('respects `options.ignore` values (RegExp)', () => {
					return nightmare.goto(`${base}/foobar`)
						.evaluate(() => document.documentElement.textContent)
						.then(text => {
							assert.equal(text, 'foobar');
						});
				});

				it('respects `options.ignore` values (String #1)', () => {
					return nightmare.goto(`${base}/buzz`)
						.evaluate(() => document.documentElement.textContent)
						.then(text => {
							assert.equal(text, 'buzz');
						});
				});

				it('respects `options.ignore` values (String #2)', () => {
					return nightmare.goto(`${base}/fizzer`)
						.evaluate(() => document.documentElement.textContent)
						.then(text => {
							assert.equal(text, 'fizzer');
						});
				});

				it('respects `options.ignore` values (Function)', () => {
					return nightmare.goto(`${base}/hello`)
						.evaluate(() => document.documentElement.textContent)
						.then(text => {
							assert.equal(text, 'hello');
						});
				});
			}

			it('does not attempt client-side navigation to server routes', () => {
				return nightmare.goto(`${base}/blog/how-is-sapper-different-from-next`)
					.init()
					.click(`[href="blog/how-is-sapper-different-from-next.json"]`)
					.wait(200)
					.page.text()
					.then(text => {
						JSON.parse(text);
					});
			});

			it('does not serve error page for non-page errors', () => {
				return nightmare.goto(`${base}/throw-an-error`)
					.page.text()
					.then(text => {
						assert.equal(text, 'nope');
					});
			});

			it('encodes routes', () => {
				return nightmare.goto(`${base}/fünke`)
					.page.title()
					.then(title => {
						assert.equal(title, `I'm afraid I just blue myself`);
					});
			});

			it('serializes Set objects returned from preload', () => {
				return nightmare.goto(`${base}/preload-values/set`)
					.page.title()
					.then(title => {
						assert.equal(title, 'true');
						return nightmare.init().page.title();
					})
					.then(title => {
						assert.equal(title, 'true');
					});
			});

			it('bails on custom classes returned from preload', () => {
				return nightmare.goto(`${base}/preload-values/custom-class`)
					.page.title()
					.then(title => {
						assert.equal(title, '42');
						return nightmare.init().page.title();
					})
					.then(title => {
						assert.equal(title, '42');
					});
			});

			it('renders store props', () => {
				return nightmare.goto(`${base}/store`)
					.page.title()
					.then(title => {
						assert.equal(title, 'hello world');
						return nightmare.init().page.title();
					})
					.then(title => {
						assert.equal(title, 'hello world');
					});
			});

			it('sends cookies when using this.fetch with credentials: "include"', () => {
				return nightmare.goto(`${base}/credentials?creds=include`)
					.page.title()
					.then(title => {
						assert.equal(title, 'a: 1, b: 2, max-age: undefined');
					});
			});

			it('does not send cookies when using this.fetch without credentials', () => {
				return nightmare.goto(`${base}/credentials`)
					.page.title()
					.then(title => {
						assert.equal(title, 'unauthorized');
					});
			});

			it('delegates to fetch on the client', () => {
				return nightmare.goto(base).init()
					.click('[href="credentials?creds=include"]')
					.wait(100)
					.page.title()
					.then(title => {
						assert.equal(title, 'a: 1, b: 2, max-age: undefined');
					});
			});

			it('includes service worker', () => {
				return nightmare.goto(base).page.html().then(html => {
					assert.ok(html.indexOf('service-worker.js') !== -1);
				});
			});

			it('sets preloading true when appropriate', () => {
				return nightmare
					.goto(base)
					.init()
					.click('a[href="slow-preload"]')
					.wait(100)
					.evaluate(() => {
						const progress = document.querySelector('progress');
						return !!progress;
					})
					.then(hasProgressIndicator => {
						assert.ok(hasProgressIndicator);
					})
					.then(() => nightmare.evaluate(() => window.fulfil()))
					.then(() => nightmare.evaluate(() => {
						const progress = document.querySelector('progress');
						return !!progress;
					}))
					.then(hasProgressIndicator => {
						assert.ok(!hasProgressIndicator);
					});
			});

			it('emits a basepath', () => {
				assert.equal(captured_basepath, basepath);
			});

			// skipped because Nightmare doesn't seem to focus the <a> correctly
			it.skip('resets the active element after navigation', () => {
				return nightmare
					.goto(base)
					.init()
					.click('a[href="about"]')
					.wait(100)
					.evaluate(() => document.activeElement.nodeName)
					.then(name => {
						assert.equal(name, 'BODY');
					});
			});

			it('replaces %sapper.xxx% tags safely', () => {
				return nightmare
					.goto(`${base}/unsafe-replacement`)
					.init()
					.page.html()
					.then(html => {
						assert.equal(html.indexOf('%sapper'), -1);
					});
			});

			it('only recreates components when necessary', () => {
				return nightmare
					.goto(`${base}/foo/bar/baz`)
					.init()
					.evaluate(() => document.querySelector('#sapper').textContent)
					.then(text => {
						assert.deepEqual(text.split('\n').filter(Boolean), [
							'y: bar 1',
							'z: baz 1',
							'child segment: baz'
						]);

						return nightmare.click(`a`)
							.then(() => wait(100))
							.then(() => {
								return nightmare.evaluate(() => document.querySelector('#sapper').textContent);
							});
					})
					.then(text => {
						assert.deepEqual(text.split('\n').filter(Boolean), [
							'y: bar 1',
							'z: qux 2',
							'child segment: qux'
						]);
					});
			});

			it('uses a fallback index component if none is provided', () => {
				return nightmare.goto(`${base}/missing-index/ok`)
					.page.title()
					.then(title => {
						assert.equal(title, 'it works');
					});
			});

			it('runs preload in root component', () => {
				return nightmare.goto(`${base}/preload-root`)
					.page.title()
					.then(title => {
						assert.equal(title, 'root preload function ran: true');
					});
			});

			it('allows reserved words as route names', () => {
				return nightmare.goto(`${base}/const`).init()
					.page.title()
					.then(title => {
						assert.equal(title, 'reserved words are okay as routes');
					});
			});

			it('encodes req.params and req.query for server-rendered pages', () => {
				return nightmare.goto(`${base}/echo/page/encöded?message=hëllö+wörld`)
					.page.title()
					.then(title => {
						assert.equal(title, 'encöded (hëllö wörld)');
					});
			});

			it('encodes req.params and req.query for client-rendered pages', () => {
				return nightmare.goto(base).init()
					.click('a[href="echo/page/encöded?message=hëllö+wörld"]')
					.wait(100)
					.page.title()
					.then(title => {
						assert.equal(title, 'encöded (hëllö wörld)');
					});
			});

			it('accepts value-less query string parameter on server', () => {
				return nightmare.goto(`${base}/echo/page/empty?message`)
					.page.title()
					.then(title => {
						assert.equal(title, 'empty ()');
					});
			});

			it('accepts value-less query string parameter on client', () => {
				return nightmare.goto(base).init()
					.click('a[href="echo/page/empty?message"]')
					.wait(100)
					.page.title()
					.then(title => {
						assert.equal(title, 'empty ()');
					});
			});

			it('encodes req.params for server routes', () => {
				return nightmare.goto(`${base}/echo/server-route/encöded`)
					.page.title()
					.then(title => {
						assert.equal(title, 'encöded');
					});
			});
		});

		describe('headers', () => {
			it('sets Content-Type, Link...preload, and Cache-Control headers', () => {
				return capture(() => fetch(base)).then(responses => {
					const { headers } = responses[0];

					assert.equal(
						headers['content-type'],
						'text/html'
					);

					assert.equal(
						headers['cache-control'],
						'max-age=600'
					);

					const str = ['main', '.+?\\.\\d+']
						.map(file => {
							return `<${basepath}/client/[^/]+/${file}\\.js>;rel="preload";as="script"`;
						})
						.join(', ');

					const regex = new RegExp(str);

					assert.ok(
						regex.test(headers['link']),
						headers['link']
					);
				});
			});
		});
	});
}

function exec(cmd) {
	return new Promise((fulfil, reject) => {
		const parts = cmd.trim().split(' ');
		const proc = require('child_process').spawn(parts.shift(), parts);

		proc.stdout.on('data', data => {
			process.stdout.write(data);
		});

		proc.stderr.on('data', data => {
			process.stderr.write(data);
		});

		proc.on('error', reject);

		proc.on('close', () => fulfil());
	});
}
