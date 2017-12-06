const hostedGitInfo = require('hosted-git-info');
const semver = require('semver');
const undefsafe = require('undefsafe');
const GitHubApi = require('github');
const githubhook = require('githubhook');
const analyzer = require('@semantic-release/commit-analyzer');
const request = require('request');
const { lint, load } = require('@commitlint/core');
const json = true;
const logger =
  process.env.NODE_ENV === 'test'
    ? {
        log: () => {},
      }
    : console;

const npm = {
  registry: 'http://registry.npmjs.org/',
  tag: 'latest',
};

const github = new GitHubApi({
  version: '3.0.0',
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  timeout: 5000,
  headers: {
    'user-agent': 'semantic-release checker',
  },
});

github.authenticate({
  type: 'oauth',
  token: process.env.TOKEN, // personal token
});

function computeChange(repo, ref, data) {
  var action = undefsafe(data, 'action');
  var valid = {
    synchronize: 1,
    opened: 1,
  };

  if (!valid[action]) {
    return false;
  }

  if (data.pull_request.state !== 'open') {
    // ignore closed PRs
    return false;
  }

  var info = hostedGitInfo.fromUrl(data.repository.full_name);
  info.committish = 'HEAD'; // read from master, not the PR
  var url = info.file('package.json');

  // get the package.json
  request({ url, json }, (error, res, body) => {
    if (error) {
      return error;
    }

    var version = body.version;

    // try to get the latest version from npm
    request(
      { url: `${npm.registry}${body.name}/${npm.tag}`, json },
      (error, res, body) => {
        if (res.statusCode === 200) {
          version = body.version;
        }

        const [owner, repo] = data.repository.full_name.split('/');

        github.repos.createStatus(
          {
            state: 'pending',
            context: 'ci/semantic-release',
            sha: data.pull_request.head.sha,
            owner,
            repo,
            description:
              'waiting for all commits to be semantic-release compatible',
          },
          () => {
            console.log('pending sent');
          }
        );

        github.pullRequests.getCommits(
          {
            repo,
            owner,
            number: data.number,
            per_page: 100,
          },
          (error, commits) => {
            processNextVersion(data.repository.full_name, commits.data, version)
              .then(msg => {
                msg.owner = owner;
                msg.repo = repo;
                github.repos.createStatus(msg, error => {
                  if (error) {
                    console.log(error);
                  }

                  console.log('integration completed', msg.description);
                });
              })
              .catch(e => console.log(e.stack));
          }
        );
      }
    );
  });
}

function processNextVersion(repo, data, version) {
  const commits = data.map(_ => ({
    message: _.commit.message,
    hash: _.sha,
  }));

  // TODO extend this out to configuration
  const lintConfig = {
    extends: ['@commitlint/config-conventional'],
    rules: {
      'subject-case': [
        1,
        'always',
        ['lowercase', 'sentence-case', 'start-case'],
      ],
      'body-tense': [0, 'never', 0],
      lang: 'eng',
    },
  };

  return load(lintConfig)
    .then(options => {
      const check = commit => lint(commit.message, options.rules);
      return Promise.all(commits.map(check));
    })
    .then(report => {
      const badIndex = report.findIndex(({ valid }) => !valid);

      if (badIndex !== -1) {
        const bad = report[badIndex];
        const { hash: sha, message } = commits[badIndex];
        const errors = bad.errors.map(error => `[${error.name}]`).join(' ');

        return {
          state: 'failure',
          target_url: `https://github.com/${repo}/commit/${sha}`,
          description: `${errors} \`${message}\``,
          context: 'ci/semantic-release',
          sha,
        };
      }

      return analyzer({}, { commits, logger }).then(res => {
        var next = semver.inc(version, res);
        let description = 'no new release expected';
        if (next !== null) {
          description = `expected next release: ${next}`;
        }

        return {
          state: 'success',
          context: 'ci/semantic-release',
          description,
          sha: commits.slice(-1).pop().hash,
        };
      });
    });
}

function listen() {
  var hook = githubhook({
    host: '0.0.0.0',
    port: process.env.PORT || 8082,
    path: '/',
    secret: process.env.SECRET,
  });

  hook.on('pull_request', computeChange);
  hook.listen();
}

if (module.parent) {
  module.exports = {
    computeChange,
    processNextVersion,
  };
} else {
  listen();
}
