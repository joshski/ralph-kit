#!/bin/bash
# Configure git to use gh for credential management
git config --global --replace-all credential.helper ""
git config --global --add credential.helper "!/usr/bin/gh auth git-credential"
