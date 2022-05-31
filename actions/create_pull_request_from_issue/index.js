const tools = require('../tools.js'),
    config = require('../config.js'),
    core = require('@actions/core'),
    github = require('@actions/github'),
    md2json = require('md-2-json'),
    token = core.getInput('token'),
    context = github.context,
    octokit = github.getOctokit(token),
    payload = context.payload,
    repositoryOwner = config.repositoryOwner,
    repositoryName = config.repositoryName,
    typeLabelPrefix = config.labelPrefixType,
    expertLabelPrefix = config.labelPrefixExpert,
    testLabelPrefix = config.labelPrefixTest,
    projectCard = payload.project_card,
    commons = require('../commons.js'),
    issueNumber = tools.basename(projectCard.content_url);

try {
    process();
} catch (error) {
    core.setFailed(error.message);
}

async function process() {
    // only create the pull request when the issue has been moved into the "in progress" column
    let columnName = await getColumnName();
    if (columnName !== config.columnTriggeringPullRequest) {
        return;
    }

    // an issue has to be associated to the project card to continue
    let issue = await getIssue();
    if (issue == undefined) {
        cancel('You must associate an issue to the project card!');
    }

    if (issue.milestone == undefined) {
        cancel('You must associate a milestone to the issue of the project card!');
    }

    let labels = await getLabels(),
        issueType = labels.type;

    // if label type is not provided -> cancel the action
    if (issueType == undefined) {
        cancel('You must provide the Type:xxx label');
    }

    // do not create branch + pull request if not type feature or type bug
    if (!config.issueTypesTriggeringPullRequest.includes(issueType)) {
        return;
    }

    let milestoneTitle = issue.milestone.title,
        branchName = [issueType.substring(typeLabelPrefix.length), tools.stringToSlug(issue.title)].join('/').toLowerCase(),
        pullRequestName = '[' + milestoneTitle + '] ' + issue.title,
        releaseBranchName = 'release/v' + milestoneTitle;

    // get or create the pull request branch
    await getOrCreateBranch(releaseBranchName, branchName);
    // create a new file into the .changelog directory
    await createTemporaryChangelog(issue, releaseBranchName);
    // await updateChangeLog(milestoneTitle, issue, branchName, releaseBranchName);

    // TRICKY ALERT!!
    // we have to create the draft pull request on dev and use the resolves keyword to link the PR and the issue
    // then we have to update the pr base  to the release branch
    let { data: pullRequest } = await octokit.pulls.create({
        owner: repositoryOwner,
        repo: repositoryName,
        title: pullRequestName,
        head: branchName,
        base: config.releaseBranchName,
        draft: 'yes',
        issue: issue,
    });

    // change the base of the pull request for the release branch
    // octokit.pulls.update({
    //     owner: repositoryOwner,
    //     repo: repositoryName,
    //     pull_number: pullRequest.number,
    //     base: releaseBranchName,
    // });

    // as the pull request is created by the github bot, we set the author into a comment
    // as it's impossible to link an issue through github api, we add a link into a comment
    let metadata = {
        github_metadata: {
            author: payload.sender.login,
        },
    };
    await octokit.issues.createComment({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: pullRequest.number,
        body: JSON.stringify(metadata),
    });

    // transfer the issue labels on the PR
    labels.expert.push(issueType);
    addLabels(labels.expert, pullRequest.number);
    addLabels(labels.test, pullRequest.number);

    // assign the author of the pull request
    assign([payload.sender.login], pullRequest);
}

/**
 * Get the branch corresponding to the issue name or create it
 * @param {string} releaseBranchName
 * @param {string} branchName
 */
async function getOrCreateBranch(releaseBranchName, branchName) {
    let targetBranch = null;

    try {
        targetBranch = await getBranch(branchName);
    } catch (error) {
        // catch error if the branch does not exists
    }

    // don't recreate an existing branch
    if (targetBranch === null) {
        let releaseBranch = await getBranch(releaseBranchName),
            originSha = releaseBranch.commit.sha;

        let response = await octokit.git.createRef({
            owner: repositoryOwner,
            repo: repositoryName,
            ref: 'refs/heads/' + branchName,
            sha: originSha,
        });

        targetBranch = response.object;
    }

    return targetBranch;
}

async function createTemporaryChangelog(issue, branchName) {
    // create the new entry to add to the changelog
    let changelogRaw = getChangelogRaw(issue),
        response = await octokit.repos.createOrUpdateFileContents({
            owner: repositoryOwner,
            repo: repositoryName,
            path: '.changelogs/' + branchName+ ".md",
            message: 'update changelog',
            // content has to be base64 encoded
            content: tools.base64Encode(md2json.toMd({ raw: changelogRaw })),
            branch: branchName,
            committer: {
                name: payload.sender.login,
                email: payload.sender.email,
            },
            author: {
                name: payload.sender.login,
                email: payload.sender.email,
            },
        });

    return response;
}

/**
 * Get a branch by its name
 * @param {string} name
 */
async function getBranch(name) {
    let { data: branch } = await octokit.repos.getBranch({
        owner: repositoryOwner,
        repo: repositoryName,
        branch: name,
    });

    return branch;
}

/**
 * Get the issueof the project card
 */
async function getIssue() {
    let { data: issue } = await octokit.issues.get({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: issueNumber,
    });

    return issue;
}

/**
 * Get the issue labels (type + expert) as an associative array
 */
async function getLabels() {
    // get all the current labels of the issue
    let { data: currentLabels } = await octokit.issues.listLabelsOnIssue({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
        }),
        list = { expert: [], test: [] };

    // and remove those with the 'State:' prefix
    currentLabels.forEach(function(currentLabel) {
        if (currentLabel.name.substring(0, typeLabelPrefix.length) === typeLabelPrefix) {
            if (list.type == undefined) {
                list.type = currentLabel.name;
            } else {
                list.type.push(currentLabel.name);
            }
        }
        if (currentLabel.name.substring(0, expertLabelPrefix.length) === expertLabelPrefix) {
            list.expert.push(currentLabel.name);
        }
        if (currentLabel.name.substring(0, testLabelPrefix.length) === testLabelPrefix) {
            list.test.push(currentLabel.name);
        }
    });

    return list;
}

/**
 * Retrieve the column name by its id
 */
async function getColumnName() {
    let columnId = projectCard.column_id;

    let { data: column } = await octokit.projects.getColumn({
        column_id: columnId,
    });

    return column.name;
}

/**
 * Build the content to add to the changelog
 * @param {object} issue
 */
function getChangelogRaw(issue) {
    return '- [' + issue.title + '](' + issue.html_url + ') (@' + payload.sender.login + ')\n';
}

/**
 * Add many labels to an issue
 * @param {array} labels
 * @param {integer} number
 */
function addLabels(labels, number) {
    octokit.issues.addLabels({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: number,
        labels: labels,
    });
}

/**
 * Cancel the current action and move the project card back to its original column
 * @param {string} message
 */
function cancel(message) {
    octokit.projects.moveCard({
        card_id: projectCard.id,
        position: 'top',
        column_id: payload.changes.column_id.from,
    });
    throw new Error(message);
}

/**
 * Assigne many collaborators to the given issue
 * @param {array} assignees
 * @param {integer} number
 */
function assign(assignees, pullRequest) {
    assignees.forEach(assignee => {
        commons.assign(repositoryOwner, repositoryName, pullRequest.number, assignee, 'Ta pull request a bien été créée! ' + pullRequest.html_url);
    });
}