<?php

declare(strict_types=1);

namespace Site\Controllers;

use Melodic\Controller\MvcController;
use Melodic\Core\Application;
use Melodic\Http\Response;

class DocsController extends MvcController
{
    public function __construct(\Melodic\View\ViewEngine $viewEngine, private readonly Application $app)
    {
        parent::__construct($viewEngine);
    }

    public function index(): Response
    {
        $this->setLayout('layouts/main');

        $this->viewBag->title = 'Envy docs — install, URLs, domains & the daemon';
        $this->viewBag->description = 'How to use Envy: install the app, enable the local HTTPS daemon, give ' .
            'containers custom domains, and manage trusted certificates.';
        $this->viewBag->canonical = 'https://' . $this->app->config('app.domain', 'envy.melodic.dev') . '/docs';

        return $this->view('docs/index', [
            'config' => $this->app->getConfiguration()->all(),
        ]);
    }
}
