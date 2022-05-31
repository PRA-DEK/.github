module.exports = {
    repositoryOwner: 'PRA-DEK',
    repositoryName: 'Mobile',

    // the prefix for types labels
    labelPrefixType: 'Type:',

    // the prefix for tests labels
    labelPrefixTest: 'Test:',

    // the github bot name
    botName: 'github-actions[bot]',

    // the permanent reviewer
    permanentReviewer: 'darkkem',

    // the collaborator in charge of merges
    mergeator: 'darkkem',

    // the minimum of reviewers requested for a pull request
    minimumuReviewersNumber: 2,

    // the minimum of approvals required to validate a pull request
    requiredApprovalsNumber: 2,

    // the list of collaborators allowed to review pull requests and issues
    reviewers: ['darkkem'],

    columnTriggeringPullRequest: 'In Progress',
    inProgressColumn: 'In Progress',
    inReviewColumn: 'In Review',
    issueTypesTriggeringPullRequest: ['Type:Feature', 'Type:Bug'],
    mainBranch: 'main',
    releasePrefix: 'release/v',
};