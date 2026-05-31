#!/bin/bash

export VITE_IS_FOR_TUNNEL=true

doppler run --project web --config dev_personal -- vite --host
