const core = require('@actions/core'),
    github = require('@actions/github'),
    tools = require('./tools.js'),
    config = require('./config.js'),
    token = core.getInput('token'),
    octokit = github.getOctokit(token),
    repositoryOwner = config.repositoryOwner,
    repositoryName = config.repositoryName,
    fetch = require('node-fetch');

module.exports = {
    /**
     * Get the pull request author even if created by git bot
     * @param {Issue} pullRequest
     */
    getPullRequestAuthor: async function(pullRequest) {
        try {
            var author = pullRequest.user.login;

            // if the pull request was created by github bot -> find author into the metadata comment
            if (author == config.botName) {
                let { data: comments } = await octokit.issues.listComments({
                    owner: repositoryOwner,
                    repo: repositoryName,
                    issue_number: pullRequest.number,
                });

                var metadata = null;
                comments.forEach(function(comment) {
                    let body = comment.body;

                    if (metadata === null && body.indexOf('github_metadata') > -1) {
                        let metadata = JSON.parse(body);
                        author = metadata.github_metadata.author;
                    }
                });
            }
            return author;
        } catch (error) {
            core.setFailed(error.message);
        }
    },
    /**
     * Retrieves the current labels of the pull request
     */
    getLabels: async function(pullRequest) {
        try {
            let { data: labels } = await octokit.issues.listLabelsOnIssue({
                owner: repositoryOwner,
                repo: repositoryName,
                issue_number: pullRequest.number,
            });
            var results = [];

            labels.forEach(function(label) {
                results.push(label.name);
            });

            return results;
        } catch (error) {
            core.setFailed(error.message);
        }
    },

    assign: async function(repositoryOwner, repositoryName, pullNumber, assignee, notification) {
        octokit.issues.addAssignees({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: pullNumber,
            assignees: [assignee],
        });

        this.notify(assignee, notification);
    },
    notify: function(user, message, link) {
        if (config.slack.users[user] != undefined) {
            const notification = message + ' ' + (link || '');
            const payload = {
                channel: config.slack.users[user],
                text: notification,
            };

            fetch(config.slack.endpoints.post_message.url, {
                method: config.slack.endpoints.post_message.method,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': notification.length,
                    Authorization: 'Bearer ' + config.slack.api_token,
                    Accept: 'application/json',
                },
            })
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`Server error ${res.status}`);
                    }

                    return res.json();
                })
                .catch(error => {
                    console.log(error);
                });
        }
    },
};