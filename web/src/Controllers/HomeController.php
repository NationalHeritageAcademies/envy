<?php

declare(strict_types=1);

namespace Site\Controllers;

use Melodic\Controller\MvcController;
use Melodic\Core\Application;
use Melodic\Http\Response;

class HomeController extends MvcController
{
    public function __construct(\Melodic\View\ViewEngine $viewEngine, private readonly Application $app)
    {
        parent::__construct($viewEngine);
    }

    public function index(): Response
    {
        $this->setLayout('layouts/main');

        $this->viewBag->title = 'Envy — Every Docker container gets a real HTTPS URL';
        // Kept under 160 chars so Google + social previews don't truncate.
        $this->viewBag->description = 'Envy gives every Docker container a zero-config HTTPS URL on your machine. ' .
            'Auto DNS, trusted local certs, a clean menu-bar & tray app. Free & open source.';
        $this->viewBag->canonical = 'https://' . $this->app->config('app.domain', 'envy.melodic.dev') . '/';

        return $this->view('home/index', [
            'config' => $this->app->getConfiguration()->all(),
        ]);
    }
}
