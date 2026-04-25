#!/bin/bash

export NEXT_PUBLIC_IS_TUNNEL=true

doppler run -- next dev --turbo
