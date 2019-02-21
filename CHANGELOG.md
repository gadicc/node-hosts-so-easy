## [1.2.6](https://github.com/gadicc/node-hosts-so-easy/compare/v1.2.5...v1.2.6) (2019-02-21)


### Bug Fixes

* **package:** remove lodash dependency ([7003364](https://github.com/gadicc/node-hosts-so-easy/commit/7003364))

## [1.2.5](https://github.com/gadicc/node-hosts-so-easy/compare/v1.2.4...v1.2.5) (2019-02-20)


### Bug Fixes

* **win:** Windows support (newlines, host location); merges [#356](https://github.com/gadicc/node-hosts-so-easy/issues/356) from angular-moon ([15a4382](https://github.com/gadicc/node-hosts-so-easy/commit/15a4382))

<a name="1.2.4"></a>
## [1.2.4](https://github.com/gadicc/node-hosts-so-easy/compare/v1.2.3...v1.2.4) (2018-06-28)


### Bug Fixes

* **package:** bump lodash, fixes Prototype Pollution vulnerability. ([de58c24](https://github.com/gadicc/node-hosts-so-easy/commit/de58c24))

<a name="1.2.3"></a>
## [1.2.3](https://github.com/gadicc/node-hosts-so-easy/compare/2a61e5137a724276db367e804f9f0accc407c901...v1.2.3) (2018-02-13)


### Bug Fixes

* all arguments of all functions (and config) are now validated ([fb57949](https://github.com/gadicc/node-hosts-so-easy/commit/fb57949))

<a name="1.2.2"></a>
## [1.2.2](https://github.com/gadicc/node-hosts-so-easy/compare/d3eeb912f9d55c291e207873c80602ac0536ac1d...v1.2.2) (2018-01-16)


### Bug Fixes

* **modify:** cleanup line when removing an entire hostline ([a520ed4](https://github.com/gadicc/node-hosts-so-easy/commit/a520ed4))

<a name="1.2.1"></a>
## [1.2.1](https://github.com/gadicc/node-hosts-so-easy/compare/9898bb01cb105879fb0f1cd69dc56a4deee2f73e...v1.2.1) (2018-01-16)


### Bug Fixes

* **header:** fix header insert location ([d3eeb91](https://github.com/gadicc/node-hosts-so-easy/commit/d3eeb91))

<a name="1.2.0"></a>
# [1.2.0](https://github.com/gadicc/node-hosts-so-easy/compare/v1.1.5...v1.2.0) (2018-01-06)


### Features

* **remove:** remove('*', host) now works like removeHost(host). ([65bf8c3](https://github.com/gadicc/node-hosts-so-easy/commit/65bf8c3))

# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.1.4] - 2017-12-09
### Changed
- Update `README` with new repo location.  Publish was required to refresh
  the README on npmjs.org.  Additionally, misc CI and tooling updates.
  NO CODE CHANGE.

## [v1.1.3] - 2017-12-09
### Changed
- Update `eventemitter3` dependency from `^2.0.3` to `^3.0.0`.

## [v1.1.2] - 2017-12-08
### Changed
- Updated mention of old event names in README.

## [v1.1.1] - 2017-12-08
### Fixed
- Force `yarn build` before publish (to publish babel transpiled files).

## [v1.1.0] - 2017-12-08
### Added
- Ability to maintain a header block and add keep entries there.
- API write-up in README.

### Changed
- Improved skip line handling, including lines of all whitespace.

## 1.0.3 - 2017-12-08

[Unreleased]: https://github.com/gadicc/hosts-so-easy/compare/v1.1.4...HEAD
[v1.1.4]: https://github.com/gadicc/hosts-so-easy/compare/v1.1.3...v1.1.4
[v1.1.3]: https://github.com/gadicc/hosts-so-easy/compare/v1.1.2...v1.1.3
[v1.1.2]: https://github.com/gadicc/hosts-so-easy/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/gadicc/hosts-so-easy/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/gadicc/hosts-so-easy/compare/v1.0.3...v1.1.0
